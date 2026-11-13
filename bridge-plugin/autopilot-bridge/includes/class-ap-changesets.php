<?php
defined( 'ABSPATH' ) || exit;

/**
 * Changesets: staged edits kept in an overlay (never touching live data) until promoted.
 *
 * overlay = { posts: { <id>: { fields: {post_title,…}, meta: {<key>: <value>} } }, options: { <name>: <value> } }
 * base    = { "<object key>": sha256(live value at stage time) }  → drift check on promote
 */
class AP_Changesets {
	const CSS_OPTION    = 'ap_bridge_css';
	const FIELDS        = array( 'post_title', 'post_content', 'post_excerpt' );
	const OPTIONS       = array( 'blogname', 'blogdescription', self::CSS_OPTION );
	const SEO_KEYS      = array(
		'yoast'    => array( 'title' => '_yoast_wpseo_title', 'description' => '_yoast_wpseo_metadesc' ),
		'rankmath' => array( 'title' => 'rank_math_title', 'description' => 'rank_math_description' ),
	);
	const MEDIA_MIMES   = array( 'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif' );
	const MEDIA_MAX     = 10485760;

	/* ---------------------------------------------------------------- storage */

	public static function load( $id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . AP_Store::t( 'changesets' ) . ' WHERE id = %s', $id ), ARRAY_A ); // phpcs:ignore
		if ( ! $row ) {
			return null;
		}
		foreach ( array( 'ops', 'overlay', 'base', 'created_posts' ) as $k ) {
			$row[ $k ] = $row[ $k ] ? json_decode( $row[ $k ], true ) : array();
		}
		$row['overlay'] += array( 'posts' => array(), 'options' => array() );
		return $row;
	}

	private static function save( $cs, $insert ) {
		global $wpdb;
		$data = array(
			'status'          => $cs['status'],
			'updated'         => current_time( 'mysql', true ),
			'ops'             => wp_json_encode( $cs['ops'] ),
			'overlay'         => wp_json_encode( $cs['overlay'] ),
			'base'            => wp_json_encode( $cs['base'] ),
			'created_posts'   => wp_json_encode( $cs['created_posts'] ),
			'preview_hash'    => $cs['preview_hash'],
			'preview_expires' => (int) $cs['preview_expires'],
			'snapshot_id'     => (int) $cs['snapshot_id'],
		);
		if ( $insert ) {
			$data['id']      = $cs['id'];
			$data['created'] = $data['updated'];
			return false !== $wpdb->insert( AP_Store::t( 'changesets' ), $data );
		}
		return false !== $wpdb->update( AP_Store::t( 'changesets' ), $data, array( 'id' => $cs['id'] ) );
	}

	public static function find_by_token( $token ) {
		global $wpdb;
		if ( ! preg_match( '/^[a-f0-9]{48}$/', (string) $token ) ) {
			return null;
		}
		$id = $wpdb->get_var( $wpdb->prepare( 'SELECT id FROM ' . AP_Store::t( 'changesets' ) . " WHERE preview_hash = %s AND status = 'staged' AND preview_expires > %d", hash( 'sha256', $token ), time() ) ); // phpcs:ignore
		return $id ? self::load( $id ) : null;
	}

	/* ---------------------------------------------------------------- stage */

	/**
	 * Apply ops to the overlay. Atomic: nothing is saved if any op fails.
	 * @return array|WP_Error
	 */
	public static function stage( $id, $ops, $ttl_hours = 72 ) {
		if ( ! preg_match( '/^[A-Za-z0-9_-]{3,64}$/', (string) $id ) ) {
			return new WP_Error( 'ap_payload', 'Invalid changeset id.', array( 'status' => 400 ) );
		}
		if ( ! is_array( $ops ) || ! $ops || count( $ops ) > 200 ) {
			return new WP_Error( 'ap_payload', 'ops must be a non-empty array (max 200).', array( 'status' => 400 ) );
		}
		$cs     = self::load( $id );
		$insert = ! $cs;
		if ( $cs && 'discarded' === $cs['status'] ) {
			$cs = null; // a discarded changeset may be re-staged from scratch (row is overwritten)
		}
		if ( $cs && 'staged' !== $cs['status'] ) {
			return new WP_Error( 'ap_state', 'Changeset is ' . $cs['status'] . '.', array( 'status' => 409 ) );
		}
		if ( ! $cs ) {
			$cs = array(
				'id' => $id, 'status' => 'staged', 'ops' => array(), 'base' => array(), 'created_posts' => array(),
				'overlay' => array( 'posts' => array(), 'options' => array() ),
				'preview_hash' => '', 'preview_expires' => 0, 'snapshot_id' => 0,
			);
		}

		$media   = array();
		$results = array();
		foreach ( array_values( $ops ) as $n => $op ) {
			$op = self::substitute_media( $op, $media );
			$r  = self::apply_op( $cs, $op, $media );
			if ( is_wp_error( $r ) ) {
				$r->add_data( array( 'status' => 422, 'op_index' => $n ) );
				AP_Store::audit( 'stage_failed', $id, array( 'op' => $n, 'error' => $r->get_error_message() ) );
				return $r;
			}
			$results[]   = $r;
			$cs['ops'][] = self::strip_heavy( $op );
		}

		$token                 = bin2hex( random_bytes( 24 ) );
		$ttl                   = max( 1, min( 168, (int) $ttl_hours ) );
		$cs['preview_hash']    = hash( 'sha256', $token );
		$cs['preview_expires'] = time() + $ttl * HOUR_IN_SECONDS;

		if ( ! self::save( $cs, $insert ) ) {
			return new WP_Error( 'ap_db', 'Could not save changeset.', array( 'status' => 500 ) );
		}
		AP_Store::audit( 'staged', $id, array( 'ops' => count( $ops ) ) );
		return array(
			'changeset'       => $id,
			'results'         => $results,
			'preview_url'     => add_query_arg( 'ap_preview', $token, home_url( '/' ) ),
			'preview_expires' => gmdate( 'c', $cs['preview_expires'] ),
		);
	}

	public static function new_token( $id, $ttl_hours = 72 ) {
		$cs = self::load( $id );
		if ( ! $cs || 'staged' !== $cs['status'] ) {
			return new WP_Error( 'ap_state', 'Changeset not staged.', array( 'status' => 409 ) );
		}
		$token                 = bin2hex( random_bytes( 24 ) );
		$cs['preview_hash']    = hash( 'sha256', $token );
		$cs['preview_expires'] = time() + max( 1, min( 168, (int) $ttl_hours ) ) * HOUR_IN_SECONDS;
		self::save( $cs, false );
		return array( 'preview_url' => add_query_arg( 'ap_preview', $token, home_url( '/' ) ), 'preview_expires' => gmdate( 'c', $cs['preview_expires'] ) );
	}

	private static function apply_op( &$cs, $op, &$media ) {
		$type    = (string) ( $op['op'] ?? '' );
		$target  = (array) ( $op['target'] ?? array() );
		$payload = $op['payload'] ?? array();

		switch ( $type ) {
			case 'page.update_section':
			case 'template.update':
				return self::op_section( $cs, $target, (array) $payload, (string) ( $op['expect_before_hash'] ?? '' ) );
			case 'page.update_content':
				return self::op_content( $cs, $target, (array) $payload, (string) ( $op['expect_before_hash'] ?? '' ) );
			case 'page.create':
				return self::op_create( $cs, (array) $payload );
			case 'css.update':
				return self::op_css( $cs, (array) $payload );
			case 'option.update':
				$name = (string) ( $target['name'] ?? '' );
				if ( ! in_array( $name, self::OPTIONS, true ) || self::CSS_OPTION === $name ) {
					return new WP_Error( 'ap_forbidden', "Option $name is not editable." );
				}
				self::set_option( $cs, $name, sanitize_text_field( (string) ( $payload['value'] ?? '' ) ) );
				return array( 'op' => $type, 'option' => $name );
			case 'seo.update':
				return self::op_seo( $cs, $target, (array) $payload );
			case 'media.upload':
				return self::op_media( (array) $payload, $media );
			case 'menu.update':
				return new WP_Error( 'ap_not_implemented', 'menu.update is not available in this version.' );
		}
		return new WP_Error( 'ap_payload', 'Unknown op: ' . $type );
	}

	private static function op_section( &$cs, $target, $payload, $expect ) {
		$pid  = (int) ( $target['post_id'] ?? 0 );
		$post = $pid ? get_post( $pid ) : null;
		if ( ! $post ) {
			return new WP_Error( 'ap_not_found', "Post $pid not found." );
		}
		if ( isset( $target['element_id'] ) ) {
			if ( ! AP_Adapter_Elementor::is_elementor( $pid ) ) {
				return new WP_Error( 'ap_payload', "Post $pid is not built with Elementor." );
			}
			$live = (string) get_post_meta( $pid, AP_Adapter_Elementor::META, true );
			if ( $expect && ! hash_equals( $expect, hash( 'sha256', $live ) ) ) {
				return new WP_Error( 'ap_drift', "Post $pid changed since inventory; re-read before editing." );
			}
			$cur = self::current_meta( $cs, $pid, AP_Adapter_Elementor::META, $live );
			$new = AP_Adapter_Elementor::apply( $cur, (string) $target['element_id'], $payload );
			if ( is_wp_error( $new ) ) {
				return $new;
			}
			self::set_meta( $cs, $pid, AP_Adapter_Elementor::META, $new, $live );
			return array( 'op' => 'page.update_section', 'post_id' => $pid, 'adapter' => 'elementor' );
		}
		if ( isset( $target['block_path'] ) ) {
			$live = (string) $post->post_content;
			if ( $expect && ! hash_equals( $expect, hash( 'sha256', $live ) ) ) {
				return new WP_Error( 'ap_drift', "Post $pid changed since inventory; re-read before editing." );
			}
			$cur = self::current_field( $cs, $pid, 'post_content', $live );
			$new = AP_Adapter_Gutenberg::apply( $cur, (array) $target['block_path'], $payload );
			if ( is_wp_error( $new ) ) {
				return $new;
			}
			self::set_field( $cs, $pid, 'post_content', wp_kses_post( $new ), $live );
			return array( 'op' => 'page.update_section', 'post_id' => $pid, 'adapter' => 'gutenberg' );
		}
		return new WP_Error( 'ap_payload', 'target needs element_id (Elementor) or block_path (Gutenberg).' );
	}

	private static function op_content( &$cs, $target, $payload, $expect ) {
		$pid  = (int) ( $target['post_id'] ?? 0 );
		$post = $pid ? get_post( $pid ) : null;
		if ( ! $post ) {
			return new WP_Error( 'ap_not_found', "Post $pid not found." );
		}
		if ( $expect && ! hash_equals( $expect, hash( 'sha256', (string) $post->post_content ) ) ) {
			return new WP_Error( 'ap_drift', "Post $pid changed since inventory; re-read before editing." );
		}
		$done = array();
		foreach ( self::FIELDS as $f ) {
			if ( array_key_exists( $f, $payload ) ) {
				$v = (string) $payload[ $f ];
				$v = ( 'post_content' === $f ) ? wp_kses_post( $v ) : sanitize_text_field( $v );
				self::set_field( $cs, $pid, $f, $v, (string) $post->$f );
				$done[] = $f;
			}
		}
		if ( ! $done ) {
			return new WP_Error( 'ap_payload', 'Nothing to update.' );
		}
		return array( 'op' => 'page.update_content', 'post_id' => $pid, 'fields' => $done );
	}

	private static function op_create( &$cs, $p ) {
		$type = in_array( $p['post_type'] ?? 'page', array( 'page', 'post' ), true ) ? ( $p['post_type'] ?? 'page' ) : 'page';
		$slug = sanitize_title( (string) ( $p['post_name'] ?? $p['post_title'] ?? '' ) );
		if ( '' === $slug || empty( $p['post_title'] ) ) {
			return new WP_Error( 'ap_payload', 'page.create needs post_title (and optional post_name).' );
		}
		if ( get_page_by_path( $slug, OBJECT, $type ) ) {
			return new WP_Error( 'ap_conflict', "Slug $slug already exists." );
		}
		$pid = wp_insert_post( wp_slash( array(
			'post_type'    => $type,
			'post_status'  => 'draft',
			'post_title'   => sanitize_text_field( (string) $p['post_title'] ),
			'post_name'    => $slug,
			'post_content' => wp_kses_post( (string) ( $p['post_content'] ?? '' ) ),
			'post_parent'  => (int) ( $p['post_parent'] ?? 0 ),
		) ), true );
		if ( is_wp_error( $pid ) ) {
			return $pid;
		}
		update_post_meta( $pid, '_ap_changeset', $cs['id'] );
		if ( ! empty( $p['page_template'] ) ) {
			update_post_meta( $pid, '_wp_page_template', sanitize_text_field( (string) $p['page_template'] ) );
		}
		if ( isset( $p['elementor_data'] ) ) {
			$json = is_string( $p['elementor_data'] ) ? $p['elementor_data'] : wp_json_encode( $p['elementor_data'] );
			if ( ! is_array( json_decode( $json, true ) ) ) {
				wp_delete_post( $pid, true );
				return new WP_Error( 'ap_payload', 'elementor_data is not valid JSON.' );
			}
			update_post_meta( $pid, '_elementor_edit_mode', 'builder' );
			update_post_meta( $pid, '_elementor_template_type', 'wp-page' );
			if ( defined( 'ELEMENTOR_VERSION' ) ) {
				update_post_meta( $pid, '_elementor_version', ELEMENTOR_VERSION );
			}
			update_post_meta( $pid, '_elementor_data', wp_slash( $json ) );
		}
		$cs['created_posts'][ (string) $pid ] = $slug;
		return array( 'op' => 'page.create', 'post_id' => $pid, 'slug' => $slug );
	}

	private static function op_css( &$cs, $p ) {
		$css  = (string) ( $p['css'] ?? '' );
		$css  = wp_strip_all_tags( str_ireplace( '</style', '', $css ) );
		$live = (string) get_option( self::CSS_OPTION, '' );
		$cur  = array_key_exists( self::CSS_OPTION, $cs['overlay']['options'] ) ? (string) $cs['overlay']['options'][ self::CSS_OPTION ] : $live;
		$new  = ( 'replace' === ( $p['mode'] ?? 'append' ) ) ? $css : trim( $cur . "\n" . $css );
		self::set_option( $cs, self::CSS_OPTION, $new );
		return array( 'op' => 'css.update', 'bytes' => strlen( $new ) );
	}

	private static function op_seo( &$cs, $target, $p ) {
		$pid = (int) ( $target['post_id'] ?? 0 );
		if ( ! $pid || ! get_post( $pid ) ) {
			return new WP_Error( 'ap_not_found', "Post $pid not found." );
		}
		$plugin = defined( 'WPSEO_VERSION' ) ? 'yoast' : ( defined( 'RANK_MATH_VERSION' ) ? 'rankmath' : '' );
		if ( ! $plugin ) {
			return new WP_Error( 'ap_unsupported', 'No supported SEO plugin (Yoast / Rank Math) is active.' );
		}
		$done = array();
		foreach ( self::SEO_KEYS[ $plugin ] as $field => $key ) {
			if ( isset( $p[ $field ] ) ) {
				self::set_meta( $cs, $pid, $key, sanitize_text_field( (string) $p[ $field ] ), get_post_meta( $pid, $key, true ) );
				$done[] = $field;
			}
		}
		return array( 'op' => 'seo.update', 'post_id' => $pid, 'plugin' => $plugin, 'fields' => $done );
	}

	private static function op_media( $p, &$media ) {
		$key  = preg_replace( '/[^a-z0-9_-]/', '', strtolower( (string) ( $p['key'] ?? '' ) ) );
		$bin  = base64_decode( (string) ( $p['data_base64'] ?? '' ), true );
		$name = sanitize_file_name( (string) ( $p['filename'] ?? '' ) );
		if ( '' === $key || false === $bin || '' === $name ) {
			return new WP_Error( 'ap_payload', 'media.upload needs key, filename, data_base64.' );
		}
		if ( strlen( $bin ) > self::MEDIA_MAX ) {
			return new WP_Error( 'ap_payload', 'File too large.' );
		}
		$info = function_exists( 'getimagesizefromstring' ) ? @getimagesizefromstring( $bin ) : false; // phpcs:ignore
		$mime = $info['mime'] ?? '';
		if ( ! in_array( $mime, self::MEDIA_MIMES, true ) ) {
			return new WP_Error( 'ap_payload', 'Only JPEG, PNG, WebP, GIF or AVIF images are allowed.' );
		}
		$up = wp_upload_bits( $name, null, $bin );
		if ( ! empty( $up['error'] ) ) {
			return new WP_Error( 'ap_upload', $up['error'] );
		}
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$aid = wp_insert_attachment( array(
			'post_mime_type' => $mime,
			'post_title'     => sanitize_text_field( (string) ( $p['title'] ?? pathinfo( $name, PATHINFO_FILENAME ) ) ),
			'post_status'    => 'inherit',
		), $up['file'], 0, true );
		if ( is_wp_error( $aid ) ) {
			return $aid;
		}
		wp_update_attachment_metadata( $aid, wp_generate_attachment_metadata( $aid, $up['file'] ) );
		if ( ! empty( $p['alt'] ) ) {
			update_post_meta( $aid, '_wp_attachment_image_alt', sanitize_text_field( (string) $p['alt'] ) );
		}
		$media[ $key ] = array( 'id' => (int) $aid, 'url' => wp_get_attachment_url( $aid ) );
		AP_Store::audit( 'media_uploaded', (string) $aid, array( 'file' => basename( $up['file'] ) ) );
		return array( 'op' => 'media.upload', 'key' => $key ) + $media[ $key ];
	}

	/** Replace {{media:<key>:id}} / {{media:<key>:url}} with values uploaded earlier in this call. */
	private static function substitute_media( $op, $media ) {
		if ( ! $media ) {
			return $op;
		}
		$json = wp_json_encode( $op );
		foreach ( $media as $k => $m ) {
			$json = str_replace(
				array( '{{media:' . $k . ':id}}', '{{media:' . $k . ':url}}' ),
				array( (string) $m['id'], str_replace( '/', '\\/', $m['url'] ) ),
				$json
			);
		}
		$out = json_decode( $json, true );
		return is_array( $out ) ? $out : $op;
	}

	private static function strip_heavy( $op ) {
		if ( isset( $op['payload']['data_base64'] ) ) {
			$op['payload']['data_base64'] = '[' . strlen( $op['payload']['data_base64'] ) . ' bytes]';
		}
		return $op;
	}

	/* ---------------------------------------------------------------- overlay helpers */

	private static function current_meta( $cs, $pid, $key, $live ) {
		$o = $cs['overlay']['posts'][ (string) $pid ]['meta'] ?? array();
		return array_key_exists( $key, $o ) ? $o[ $key ] : $live;
	}

	private static function current_field( $cs, $pid, $field, $live ) {
		$o = $cs['overlay']['posts'][ (string) $pid ]['fields'] ?? array();
		return array_key_exists( $field, $o ) ? $o[ $field ] : $live;
	}

	private static function set_meta( &$cs, $pid, $key, $value, $live ) {
		$bk = "post:$pid:meta:$key";
		if ( ! isset( $cs['base'][ $bk ] ) ) {
			$cs['base'][ $bk ] = self::h( $live );
		}
		$cs['overlay']['posts'][ (string) $pid ]['meta'][ $key ] = $value;
		$cs['overlay']['posts'][ (string) $pid ] += array( 'fields' => array() );
	}

	private static function set_field( &$cs, $pid, $field, $value, $live ) {
		$bk = "post:$pid:field:$field";
		if ( ! isset( $cs['base'][ $bk ] ) ) {
			$cs['base'][ $bk ] = self::h( $live );
		}
		$cs['overlay']['posts'][ (string) $pid ]['fields'][ $field ] = $value;
		$cs['overlay']['posts'][ (string) $pid ] += array( 'meta' => array() );
	}

	private static function set_option( &$cs, $name, $value ) {
		$bk = "option:$name";
		if ( ! isset( $cs['base'][ $bk ] ) ) {
			$cs['base'][ $bk ] = self::h( get_option( $name, '' ) );
		}
		$cs['overlay']['options'][ $name ] = $value;
	}

	private static function h( $v ) {
		return hash( 'sha256', is_string( $v ) ? $v : maybe_serialize( $v ) );
	}

	private static function live_value( $key ) {
		$parts = explode( ':', $key, 4 );
		if ( 'option' === $parts[0] ) {
			return get_option( $parts[1], '' );
		}
		$pid = (int) $parts[1];
		if ( 'field' === $parts[2] ) {
			$p = get_post( $pid );
			return $p ? (string) $p->{$parts[3]} : '';
		}
		return get_post_meta( $pid, $parts[3], true );
	}

	/* ---------------------------------------------------------------- promote / discard */

	public static function promote( $id ) {
		$cs = self::load( $id );
		if ( ! $cs || 'staged' !== $cs['status'] ) {
			return new WP_Error( 'ap_state', 'Changeset not staged.', array( 'status' => 409 ) );
		}
		foreach ( array_keys( $cs['overlay']['posts'] ) as $pid ) {
			clean_post_cache( (int) $pid );
		}
		$drift = array();
		foreach ( $cs['base'] as $key => $hash ) {
			if ( ! hash_equals( $hash, self::h( self::live_value( $key ) ) ) ) {
				$drift[] = $key;
			}
		}
		if ( $drift ) {
			AP_Store::audit( 'promote_blocked_drift', $id, array( 'keys' => $drift ) );
			return new WP_Error( 'ap_drift', 'Live site changed after staging; re-stage required.', array( 'status' => 409, 'keys' => $drift ) );
		}

		$snap = self::snapshot( $cs );
		if ( ! $snap ) {
			return new WP_Error( 'ap_db', 'Snapshot failed; nothing was changed.', array( 'status' => 500 ) );
		}
		self::write_live( $cs['overlay'] );
		foreach ( array_keys( $cs['created_posts'] ) as $pid ) {
			self::set_status( (int) $pid, 'publish' );
		}
		self::purge( array_merge( array_keys( $cs['overlay']['posts'] ), array_keys( $cs['created_posts'] ) ) );

		$cs['status']       = 'promoted';
		$cs['snapshot_id']  = $snap;
		$cs['preview_hash'] = '';
		self::save( $cs, false );
		AP_Store::audit( 'promoted', $id, array( 'snapshot' => $snap ) );
		return array( 'changeset' => $id, 'status' => 'promoted', 'snapshot_id' => $snap );
	}

	public static function discard( $id ) {
		$cs = self::load( $id );
		if ( ! $cs || 'staged' !== $cs['status'] ) {
			return new WP_Error( 'ap_state', 'Changeset not staged.', array( 'status' => 409 ) );
		}
		foreach ( array_keys( $cs['created_posts'] ) as $pid ) {
			$p = get_post( (int) $pid );
			if ( $p && 'draft' === $p->post_status && get_post_meta( $p->ID, '_ap_changeset', true ) === $id ) {
				wp_delete_post( $p->ID, true );
			}
		}
		$cs['status']       = 'discarded';
		$cs['preview_hash'] = '';
		self::save( $cs, false );
		AP_Store::audit( 'discarded', $id );
		return array( 'changeset' => $id, 'status' => 'discarded' );
	}

	public static function summary( $id ) {
		$cs = self::load( $id );
		if ( ! $cs ) {
			return new WP_Error( 'ap_not_found', 'No such changeset.', array( 'status' => 404 ) );
		}
		return array(
			'changeset'       => $cs['id'],
			'status'          => $cs['status'],
			'ops'             => count( $cs['ops'] ),
			'posts'           => array_map( 'intval', array_keys( $cs['overlay']['posts'] ) ),
			'created_posts'   => array_map( 'intval', array_keys( $cs['created_posts'] ) ),
			'options'         => array_keys( $cs['overlay']['options'] ),
			'preview_expires' => $cs['preview_expires'] ? gmdate( 'c', (int) $cs['preview_expires'] ) : null,
			'snapshot_id'     => (int) $cs['snapshot_id'],
			'updated'         => $cs['updated'],
		);
	}

	/* ---------------------------------------------------------------- snapshots */

	private static function snapshot( $cs ) {
		global $wpdb;
		$data = array( 'posts' => array(), 'options' => array(), 'created' => array_map( 'intval', array_keys( $cs['created_posts'] ) ) );
		foreach ( $cs['overlay']['posts'] as $pid => $o ) {
			$post = get_post( (int) $pid );
			$s    = array( 'fields' => array(), 'meta' => array() );
			foreach ( array_keys( (array) $o['fields'] ) as $f ) {
				$s['fields'][ $f ] = $post ? (string) $post->$f : '';
			}
			foreach ( array_keys( (array) $o['meta'] ) as $k ) {
				$s['meta'][ $k ] = array( 'exists' => metadata_exists( 'post', (int) $pid, $k ), 'value' => get_post_meta( (int) $pid, $k, true ) );
			}
			$data['posts'][ $pid ] = $s;
		}
		foreach ( array_keys( $cs['overlay']['options'] ) as $name ) {
			$sentinel                  = '__ap_missing__';
			$v                         = get_option( $name, $sentinel );
			$data['options'][ $name ] = array( 'exists' => $sentinel !== $v, 'value' => $sentinel === $v ? '' : $v );
		}
		$ok = $wpdb->insert( AP_Store::t( 'snapshots' ), array(
			'changeset' => $cs['id'],
			'created'   => current_time( 'mysql', true ),
			'data'      => wp_json_encode( $data ),
		) );
		return $ok ? (int) $wpdb->insert_id : 0;
	}

	public static function restore( $snapshot_id ) {
		global $wpdb;
		$row = $wpdb->get_row( $wpdb->prepare( 'SELECT * FROM ' . AP_Store::t( 'snapshots' ) . ' WHERE id = %d', (int) $snapshot_id ), ARRAY_A ); // phpcs:ignore
		if ( ! $row ) {
			return new WP_Error( 'ap_not_found', 'No such snapshot.', array( 'status' => 404 ) );
		}
		$data = json_decode( $row['data'], true );
		foreach ( (array) $data['posts'] as $pid => $s ) {
			self::write_fields( (int) $pid, (array) $s['fields'] );
			foreach ( (array) $s['meta'] as $k => $m ) {
				if ( $m['exists'] ) {
					update_post_meta( (int) $pid, $k, wp_slash( $m['value'] ) );
				} else {
					delete_post_meta( (int) $pid, $k );
				}
			}
		}
		foreach ( (array) $data['options'] as $name => $m ) {
			if ( $m['exists'] ) {
				update_option( $name, $m['value'] );
			} else {
				delete_option( $name );
			}
		}
		foreach ( (array) $data['created'] as $pid ) {
			self::set_status( (int) $pid, 'draft' );
		}
		self::purge( array_merge( array_keys( (array) $data['posts'] ), (array) $data['created'] ) );
		$wpdb->update( AP_Store::t( 'changesets' ), array( 'status' => 'rolled_back', 'updated' => current_time( 'mysql', true ) ), array( 'id' => $row['changeset'] ) );
		AP_Store::audit( 'restored', (string) $snapshot_id, array( 'changeset' => $row['changeset'] ) );
		return array( 'snapshot_id' => (int) $snapshot_id, 'changeset' => $row['changeset'], 'status' => 'rolled_back' );
	}

	/* ---------------------------------------------------------------- live writes */

	private static function write_live( $overlay ) {
		foreach ( $overlay['posts'] as $pid => $o ) {
			self::write_fields( (int) $pid, (array) ( $o['fields'] ?? array() ) );
			foreach ( (array) ( $o['meta'] ?? array() ) as $k => $v ) {
				update_post_meta( (int) $pid, $k, wp_slash( $v ) );
			}
		}
		foreach ( $overlay['options'] as $name => $v ) {
			update_option( $name, $v, self::CSS_OPTION === $name ? true : null );
		}
	}

	/** Direct write: values were sanitised at stage; restores must be byte-exact. */
	private static function write_fields( $pid, $fields ) {
		global $wpdb;
		$fields = array_intersect_key( $fields, array_flip( self::FIELDS ) );
		if ( ! $fields ) {
			return;
		}
		$fields['post_modified']     = current_time( 'mysql' );
		$fields['post_modified_gmt'] = current_time( 'mysql', true );
		$wpdb->update( $wpdb->posts, $fields, array( 'ID' => $pid ) );
		clean_post_cache( $pid );
	}

	private static function set_status( $pid, $status ) {
		global $wpdb;
		$wpdb->update( $wpdb->posts, array( 'post_status' => $status ), array( 'ID' => $pid ) );
		clean_post_cache( $pid );
	}

	private static function purge( $post_ids ) {
		foreach ( array_unique( array_map( 'intval', $post_ids ) ) as $pid ) {
			clean_post_cache( $pid );
			delete_post_meta( $pid, '_elementor_element_cache' );
		}
		if ( class_exists( '\Elementor\Plugin' ) && isset( \Elementor\Plugin::$instance->files_manager ) ) {
			\Elementor\Plugin::$instance->files_manager->clear_cache();
		}
		do_action( 'litespeed_purge_all' );
		do_action( 'sg_cachepress_purge_cache' );
		if ( function_exists( 'rocket_clean_domain' ) ) {
			rocket_clean_domain();
		}
		if ( function_exists( 'w3tc_flush_all' ) ) {
			w3tc_flush_all();
		}
		if ( function_exists( 'wp_cache_clear_cache' ) ) {
			wp_cache_clear_cache();
		}
		do_action( 'ap_bridge_purge', $post_ids );
	}

	public static function print_css() {
		$css = (string) get_option( self::CSS_OPTION, '' );
		if ( '' !== trim( $css ) ) {
			echo "<style id=\"ap-bridge-css\">\n" . $css . "\n</style>\n"; // phpcs:ignore -- sanitised on write
		}
	}
}
