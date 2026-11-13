<?php
defined( 'ABSPATH' ) || exit;

/**
 * Functionality: code snippets (php/js/css) and WordPress.org plugin install/activate.
 *
 * Snippets live in the option `ap_bridge_snippets` {slug: {type, scope, code, description}}, so they ride the normal
 * changeset overlay: preview-only until promote, snapshot + restore for free. PHP snippets run from content-addressed
 * files in uploads/ap-snippets/ and are switched off automatically if they cause a fatal error.
 * Plugin ops cannot be previewed; they run at promote and are undone from the snapshot.
 *
 * Gate: option ap_bridge_code_mode = off (default) | snippets | all. Set by the site owner in Tools → Autopilot Bridge.
 */
class AP_Functions {
	const OPT       = 'ap_bridge_snippets';
	const OFF       = 'ap_bridge_snippets_off';
	const MODE      = 'ap_bridge_code_mode';
	const MAX_CODE  = 65536;
	const MIN_USERS = 10000;
	const PROTECTED = array( 'autopilot-bridge', 'wordfence', 'sucuri-scanner', 'ithemes-security', 'better-wp-security', 'all-in-one-wp-security-and-firewall', 'solid-security', 'wp-cerber', 'really-simple-ssl' );
	const DENY_FN   = array(
		'eval', 'exec', 'shell_exec', 'system', 'passthru', 'popen', 'proc_open', 'pcntl_exec', 'assert', 'create_function',
		'wp_delete_user', 'wp_insert_user', 'wp_create_user', 'wp_update_user', 'add_role', 'remove_role', 'wp_set_current_user',
		'wp_delete_attachment', 'dbDelta', 'wp_install', 'unlink', 'rmdir', 'file_put_contents', 'fwrite', 'fopen', 'move_uploaded_file',
		'base64_decode', 'gzinflate', 'str_rot13', 'unserialize', 'phpinfo', 'ini_set', 'set_time_limit', 'putenv', 'curl_exec',
	);

	/* ---------------------------------------------------------------- gate */

	public static function mode() {
		$m = (string) get_option( self::MODE, 'off' );
		return in_array( $m, array( 'snippets', 'all' ), true ) ? $m : 'off';
	}

	private static function need( $level ) {
		$m = self::mode();
		if ( 'all' === $m || ( 'snippets' === $m && 'snippets' === $level ) ) {
			return true;
		}
		return new WP_Error( 'ap_forbidden', 'Code changes need mode "' . ( 'all' === $level ? 'all' : 'snippets' ) . '" on this site (currently "' . $m . '"): Tools → Autopilot Bridge → Code changes.', array( 'status' => 403 ) );
	}

	/* ---------------------------------------------------------------- lint */

	public static function lint( $type, $code ) {
		$code = (string) $code;
		if ( '' === trim( $code ) || strlen( $code ) > self::MAX_CODE ) {
			return new WP_Error( 'ap_payload', 'Snippet code must be 1 byte to 64 KB.' );
		}
		if ( 'php' === $type ) {
			try {
				$tokens = token_get_all( "<?php\n" . $code, TOKEN_PARSE );
			} catch ( ParseError $e ) {
				return new WP_Error( 'ap_lint', 'PHP syntax error: ' . $e->getMessage() . ' (line ' . max( 1, $e->getLine() - 1 ) . ')' );
			}
			foreach ( $tokens as $i => $t ) {
				if ( is_string( $t ) ) {
					if ( '`' === $t ) {
						return new WP_Error( 'ap_lint', 'Backtick shell execution is not allowed.' );
					}
					continue;
				}
				if ( in_array( $t[0], array( T_EVAL, T_INCLUDE, T_INCLUDE_ONCE, T_REQUIRE, T_REQUIRE_ONCE, T_OPEN_TAG_WITH_ECHO, T_INLINE_HTML ), true ) && $i > 0 ) {
					return new WP_Error( 'ap_lint', 'Not allowed in snippets: ' . token_name( $t[0] ) . ' (line ' . ( $t[2] - 1 ) . ').' );
				}
				if ( T_STRING === $t[0] && in_array( strtolower( $t[1] ), array_map( 'strtolower', self::DENY_FN ), true ) ) {
					return new WP_Error( 'ap_lint', 'Function not allowed in snippets: ' . $t[1] . '() (line ' . ( $t[2] - 1 ) . ').' );
				}
				if ( T_CONSTANT_ENCAPSED_STRING === $t[0] && preg_match( '/\b(DROP|ALTER|TRUNCATE)\s+(TABLE|DATABASE)\b/i', $t[1] ) ) {
					return new WP_Error( 'ap_lint', 'Dropping or altering tables is not allowed.' );
				}
			}
		} elseif ( 'js' === $type ) {
			if ( preg_match( '#</script#i', $code ) || preg_match( '/createElement\(\s*[\'"]script|importScripts|\bimport\s*\(|\beval\s*\(|new\s+Function\s*\(/i', $code ) ) {
				return new WP_Error( 'ap_lint', 'JS snippet may not load scripts dynamically or use eval.' );
			}
		} elseif ( 'css' === $type ) {
			if ( preg_match( '#</style|@import|expression\s*\(|javascript:#i', $code ) ) {
				return new WP_Error( 'ap_lint', 'CSS snippet may not use @import, expression() or javascript: URLs.' );
			}
		} else {
			return new WP_Error( 'ap_payload', 'Snippet type must be php, js or css.' );
		}
		return true;
	}

	/* ---------------------------------------------------------------- snippet ops (overlay) */

	public static function op_snippet( &$cs, $op, $target, $p ) {
		$ok = self::need( 'snippets' );
		if ( is_wp_error( $ok ) ) {
			return $ok;
		}
		$slug = (string) ( $target['slug'] ?? '' );
		if ( ! preg_match( '/^[a-z0-9][a-z0-9-]{1,40}$/', $slug ) ) {
			return new WP_Error( 'ap_payload', 'Snippet slug must be 2-41 chars: a-z, 0-9, dash.' );
		}
		$all = AP_Changesets::overlay_option_value( $cs, self::OPT );
		$all = is_array( $all ) ? $all : array();
		if ( 'snippet.remove' === $op ) {
			if ( ! isset( $all[ $slug ] ) ) {
				return new WP_Error( 'ap_not_found', "No snippet $slug." );
			}
			unset( $all[ $slug ] );
			AP_Changesets::overlay_option( $cs, self::OPT, $all );
			return array( 'op' => $op, 'slug' => $slug );
		}
		$type = (string) ( $p['type'] ?? 'php' );
		$code = (string) ( $p['code'] ?? '' );
		if ( 'php' === $type ) {
			$code = preg_replace( '/^\s*<\?php\s*/i', '', $code );
			$code = preg_replace( '/\?>\s*$/', '', $code );
		}
		$lint = self::lint( $type, $code );
		if ( is_wp_error( $lint ) ) {
			return $lint;
		}
		$scope = in_array( $p['scope'] ?? 'all', array( 'front', 'admin', 'all' ), true ) ? $p['scope'] : 'all';
		if ( count( $all ) >= 40 && ! isset( $all[ $slug ] ) ) {
			return new WP_Error( 'ap_payload', 'Too many snippets (max 40).' );
		}
		$all[ $slug ] = array(
			'type'        => $type,
			'scope'       => $scope,
			'code'        => $code,
			'description' => sanitize_text_field( (string) ( $p['description'] ?? '' ) ),
		);
		AP_Changesets::overlay_option( $cs, self::OPT, $all );
		return array( 'op' => $op, 'slug' => $slug, 'type' => $type, 'scope' => $scope, 'bytes' => strlen( $code ) );
	}

	/* ---------------------------------------------------------------- runtime */

	public static function boot() {
		$all = get_option( self::OPT, array() );
		if ( ! is_array( $all ) || ! $all ) {
			return;
		}
		$off   = (array) get_option( self::OFF, array() );
		$admin = is_admin();
		foreach ( $all as $slug => $s ) {
			if ( isset( $off[ $slug ] ) && ! AP_Preview::active() ) {
				continue;
			}
			$scope = $s['scope'] ?? 'all';
			if ( ( 'front' === $scope && $admin ) || ( 'admin' === $scope && ! $admin ) ) {
				continue;
			}
			$type = $s['type'] ?? 'php';
			$code = (string) ( $s['code'] ?? '' );
			if ( 'php' === $type ) {
				self::run_php( (string) $slug, $code );
			} elseif ( 'js' === $type ) {
				add_action( $admin ? 'admin_footer' : 'wp_footer', function () use ( $slug, $code ) {
					echo '<script id="ap-js-' . esc_attr( $slug ) . "\">\n" . str_ireplace( '</script', '<\/script', $code ) . "\n</script>\n"; // phpcs:ignore
				}, 99 );
			} elseif ( 'css' === $type ) {
				add_action( $admin ? 'admin_head' : 'wp_head', function () use ( $slug, $code ) {
					echo '<style id="ap-css-' . esc_attr( $slug ) . "\">\n" . str_ireplace( '</style', '', $code ) . "\n</style>\n"; // phpcs:ignore
				}, 99 );
			}
		}
	}

	private static function run_php( $slug, $code ) {
		$dir = trailingslashit( wp_upload_dir()['basedir'] ) . 'ap-snippets';
		if ( ! is_dir( $dir ) ) {
			wp_mkdir_p( $dir );
			file_put_contents( $dir . '/index.php', "<?php // silence\n" ); // phpcs:ignore
			file_put_contents( $dir . '/.htaccess', "Require all denied\n" ); // phpcs:ignore
		}
		$file = $dir . '/' . $slug . '-' . substr( hash( 'sha256', $code ), 0, 12 ) . '.php';
		if ( ! file_exists( $file ) ) {
			file_put_contents( $file, "<?php\ndefined( 'ABSPATH' ) || exit;\n" . $code . "\n" ); // phpcs:ignore
		}
		$preview = AP_Preview::active();
		register_shutdown_function( function () use ( $slug, $file, $preview ) {
			$e = error_get_last();
			if ( $e && in_array( $e['type'], array( E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR ), true ) && false !== strpos( (string) $e['file'], 'ap-snippets' ) && false !== strpos( (string) $e['file'], '/' . $slug . '-' ) ) {
				if ( ! $preview ) {
					$off          = (array) get_option( self::OFF, array() );
					$off[ $slug ] = substr( $e['message'], 0, 200 );
					update_option( self::OFF, $off, false );
				}
				AP_Store::audit( 'snippet_disabled', $slug, array( 'error' => substr( $e['message'], 0, 200 ) ) );
			}
		} );
		try {
			include $file; // phpcs:ignore
		} catch ( Throwable $t ) {
			if ( ! $preview ) {
				$off          = (array) get_option( self::OFF, array() );
				$off[ $slug ] = substr( $t->getMessage(), 0, 200 );
				update_option( self::OFF, $off, false );
			}
			AP_Store::audit( 'snippet_disabled', $slug, array( 'error' => substr( $t->getMessage(), 0, 200 ) ) );
		}
	}

	/** Re-enable snippets that were switched off (called when a new version of that snippet is promoted). */
	public static function clear_off( $slugs ) {
		$off = (array) get_option( self::OFF, array() );
		foreach ( (array) $slugs as $s ) {
			unset( $off[ $s ] );
		}
		update_option( self::OFF, $off, false );
	}

	/* ---------------------------------------------------------------- plugins */

	/** Stage-time check only (no side effects). */
	public static function op_plugin_stage( &$cs, $op, $payload ) {
		$ok = self::need( 'all' );
		if ( is_wp_error( $ok ) ) {
			return $ok;
		}
		$slug = (string) ( $payload['slug'] ?? '' );
		if ( ! preg_match( '/^[a-z0-9][a-z0-9-]{1,80}$/', $slug ) ) {
			return new WP_Error( 'ap_payload', 'Plugin slug must be a WordPress.org slug.' );
		}
		if ( in_array( $slug, self::PROTECTED, true ) && 'plugin.install' !== $op ) {
			return new WP_Error( 'ap_forbidden', "Plugin $slug is protected." );
		}
		if ( 'plugin.install' === $op ) {
			$info = self::wporg_info( $slug );
			if ( is_wp_error( $info ) ) {
				return $info;
			}
		}
		$cs['overlay']['plugins']   = $cs['overlay']['plugins'] ?? array();
		$cs['overlay']['plugins'][] = array( 'op' => $op, 'slug' => $slug, 'activate' => ! empty( $payload['activate'] ) );
		return array( 'op' => $op, 'slug' => $slug, 'note' => 'runs at promote; not visible in preview' );
	}

	private static function wporg_info( $slug ) {
		require_once ABSPATH . 'wp-admin/includes/plugin-install.php';
		$info = plugins_api( 'plugin_information', array( 'slug' => $slug, 'fields' => array( 'active_installs' => true, 'sections' => false, 'versions' => false, 'banners' => false, 'icons' => false ) ) );
		if ( is_wp_error( $info ) ) {
			return new WP_Error( 'ap_plugin', "Plugin $slug not found on WordPress.org: " . $info->get_error_message() );
		}
		$dl = (string) ( $info->download_link ?? '' );
		if ( 0 !== strpos( $dl, 'https://downloads.wordpress.org/' ) ) {
			return new WP_Error( 'ap_plugin', 'Only WordPress.org downloads are allowed.' );
		}
		$allow = (array) get_option( 'ap_bridge_plugin_allow', array() );
		if ( (int) ( $info->active_installs ?? 0 ) < self::MIN_USERS && ! in_array( $slug, $allow, true ) ) {
			return new WP_Error( 'ap_plugin', "Plugin $slug has fewer than " . self::MIN_USERS . ' active installs; add it to the allowlist first.' );
		}
		return $info;
	}

	private static function plugin_file( $slug ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		foreach ( array_keys( get_plugins() ) as $f ) {
			if ( 0 === strpos( $f, $slug . '/' ) || $f === $slug . '.php' ) {
				return $f;
			}
		}
		return '';
	}

	/** Record prior state of every plugin the changeset touches. Called inside the snapshot. */
	public static function plugins_state( $plugins ) {
		$out = array();
		foreach ( (array) $plugins as $p ) {
			$f             = self::plugin_file( $p['slug'] );
			$out[ $p['slug'] ] = array( 'installed' => '' !== $f, 'active' => '' !== $f && is_plugin_active( $f ) );
		}
		return $out;
	}

	public static function plugins_apply( $plugins ) {
		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/misc.php';
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/class-wp-upgrader.php';
		$log = array();
		foreach ( (array) $plugins as $p ) {
			$slug = $p['slug'];
			$f    = self::plugin_file( $slug );
			if ( 'plugin.install' === $p['op'] && '' === $f ) {
				$info = self::wporg_info( $slug );
				if ( is_wp_error( $info ) ) {
					return $info;
				}
				$up  = new Plugin_Upgrader( new Automatic_Upgrader_Skin() );
				$res = $up->install( $info->download_link );
				if ( is_wp_error( $res ) || ! $res ) {
					return new WP_Error( 'ap_plugin', "Install of $slug failed." . ( is_wp_error( $res ) ? ' ' . $res->get_error_message() : '' ), array( 'status' => 500 ) );
				}
				wp_clean_plugins_cache( true );
				$f = self::plugin_file( $slug );
				if ( '' === $f ) {
					return new WP_Error( 'ap_plugin', "Plugin $slug installed but main file not found.", array( 'status' => 500 ) );
				}
			}
			$want_active = ( 'plugin.activate' === $p['op'] ) || ( 'plugin.install' === $p['op'] && $p['activate'] );
			if ( $want_active && '' !== $f && ! is_plugin_active( $f ) ) {
				$r = activate_plugin( $f );
				if ( is_wp_error( $r ) ) {
					return new WP_Error( 'ap_plugin', "Activation of $slug failed: " . $r->get_error_message(), array( 'status' => 500 ) );
				}
			}
			if ( 'plugin.deactivate' === $p['op'] && '' !== $f && is_plugin_active( $f ) ) {
				deactivate_plugins( $f );
			}
			$log[] = $p['op'] . ':' . $slug;
		}
		return $log;
	}

	/** Undo from the snapshot: remove what we installed, restore on/off state of the rest. */
	public static function plugins_restore( $state ) {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		require_once ABSPATH . 'wp-admin/includes/file.php';
		foreach ( (array) $state as $slug => $s ) {
			$f = self::plugin_file( $slug );
			if ( '' === $f ) {
				continue;
			}
			if ( empty( $s['installed'] ) ) {
				deactivate_plugins( $f );
				delete_plugins( array( $f ) );
			} elseif ( ! empty( $s['active'] ) && ! is_plugin_active( $f ) ) {
				activate_plugin( $f );
			} elseif ( empty( $s['active'] ) && is_plugin_active( $f ) ) {
				deactivate_plugins( $f );
			}
		}
	}
}
