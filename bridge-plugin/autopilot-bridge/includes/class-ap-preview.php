<?php
defined( 'ABSPATH' ) || exit;

/**
 * Full-site preview of a staged changeset.
 * ?ap_preview=<token> → sets an HttpOnly cookie → the whole site renders with the overlay for that visitor only.
 * Live visitors are never affected. Writes to overlaid posts are blocked while previewing.
 */
class AP_Preview {
	const COOKIE = 'ap_preview';

	private static $cs = null;

	public static function init() {
		add_action( 'init', array( __CLASS__, 'boot' ), 0 );
	}

	public static function active() {
		return null !== self::$cs;
	}

	public static function boot() {
		if ( is_admin() || wp_doing_cron() || ( defined( 'WP_CLI' ) && WP_CLI ) ) {
			return;
		}
		$path = isset( $_SERVER['REQUEST_URI'] ) ? (string) wp_unslash( $_SERVER['REQUEST_URI'] ) : '';
		if ( false !== strpos( $path, '/' . rest_get_url_prefix() . '/' ) || isset( $_GET['rest_route'] ) ) { // phpcs:ignore
			return;
		}

		if ( isset( $_GET['ap_preview_exit'] ) ) { // phpcs:ignore
			self::set_cookie( '', time() - 3600 );
			wp_safe_redirect( remove_query_arg( 'ap_preview_exit' ) );
			exit;
		}

		if ( isset( $_GET['ap_preview'] ) ) { // phpcs:ignore
			$token = sanitize_key( wp_unslash( $_GET['ap_preview'] ) ); // phpcs:ignore
			$cs    = AP_Changesets::find_by_token( $token );
			if ( ! $cs ) {
				self::nocache();
				wp_die( esc_html__( 'This preview link is invalid or has expired.', 'autopilot-bridge' ), 403 );
			}
			self::set_cookie( $cs['id'] . '.' . $token, (int) $cs['preview_expires'] );
			self::nocache();
			wp_safe_redirect( remove_query_arg( 'ap_preview' ) );
			exit;
		}

		$raw = isset( $_COOKIE[ self::COOKIE ] ) ? sanitize_text_field( wp_unslash( $_COOKIE[ self::COOKIE ] ) ) : '';
		if ( '' === $raw || false === strpos( $raw, '.' ) ) {
			return;
		}
		list( $id, $token ) = explode( '.', $raw, 2 );
		$cs                 = AP_Changesets::find_by_token( $token );
		if ( ! $cs || $cs['id'] !== $id ) {
			self::set_cookie( '', time() - 3600 );
			return;
		}
		self::$cs = $cs;
		self::hooks();
	}

	private static function hooks() {
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		self::nocache();

		add_filter( 'get_post_metadata', array( __CLASS__, 'meta' ), 1, 4 );
		foreach ( array( 'update_post_metadata', 'add_post_metadata', 'delete_post_metadata' ) as $hook ) {
			add_filter( $hook, array( __CLASS__, 'block_write' ), 1, 2 );
		}
		add_filter( 'the_posts', array( __CLASS__, 'posts' ), 1 );
		add_action( 'pre_get_posts', array( __CLASS__, 'allow_created' ), 1 );
		foreach ( self::$cs['overlay']['options'] as $name => $value ) {
			add_filter( 'pre_option_' . $name, function () use ( $value ) {
				return $value;
			}, 1 );
		}
		// Elementor: render CSS inline from the (overlaid) data instead of cached files.
		add_filter( 'pre_option_elementor_css_print_method', function () {
			return 'internal';
		}, 1 );
		add_action( 'wp_head', array( __CLASS__, 'robots' ), 0 );
		add_action( 'wp_footer', array( __CLASS__, 'banner' ), 999 );
	}

	public static function meta( $check, $pid, $key, $single ) {
		$o = self::$cs['overlay']['posts'][ (string) $pid ] ?? null;
		if ( ! $o || '' === $key ) {
			return $check;
		}
		if ( in_array( $key, array( '_elementor_element_cache', '_elementor_css' ), true ) ) {
			return array( '' );
		}
		if ( array_key_exists( $key, (array) $o['meta'] ) ) {
			return array( $o['meta'][ $key ] );
		}
		return $check;
	}

	public static function block_write( $check, $pid ) {
		return isset( self::$cs['overlay']['posts'][ (string) $pid ] ) || isset( self::$cs['created_posts'][ (string) $pid ] ) ? true : $check;
	}

	public static function posts( $posts ) {
		foreach ( (array) $posts as $p ) {
			$o = self::$cs['overlay']['posts'][ (string) $p->ID ]['fields'] ?? array();
			foreach ( $o as $f => $v ) {
				$p->$f = $v;
			}
			if ( isset( self::$cs['created_posts'][ (string) $p->ID ] ) ) {
				$p->post_status = 'publish';
			}
		}
		return $posts;
	}

	public static function allow_created( $q ) {
		if ( ! $q->is_main_query() || empty( self::$cs['created_posts'] ) ) {
			return;
		}
		$pid  = (int) ( $q->get( 'page_id' ) ?: $q->get( 'p' ) );
		$slug = (string) ( $q->get( 'pagename' ) ?: $q->get( 'name' ) );
		foreach ( self::$cs['created_posts'] as $id => $s ) {
			if ( $pid === (int) $id || ( '' !== $slug && basename( $slug ) === $s ) ) {
				$q->set( 'post_status', array( 'publish', 'draft' ) );
				return;
			}
		}
	}

	public static function robots() {
		echo "<meta name=\"robots\" content=\"noindex, nofollow\">\n";
	}

	public static function banner() {
		$exit = esc_url( add_query_arg( 'ap_preview_exit', '1' ) );
		printf(
			'<div id="ap-preview-bar" style="position:fixed;left:16px;bottom:16px;z-index:2147483647;display:flex;gap:12px;align-items:center;padding:10px 16px;border-radius:999px;background:#111;color:#fff;font:500 13px/1.2 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.25)">'
			. '<span>Preview · %s</span><a href="%s" style="color:#9ecbff;text-decoration:underline">Exit</a></div>',
			esc_html( self::$cs['id'] ),
			$exit // phpcs:ignore -- escaped above
		);
	}

	private static function nocache() {
		if ( ! headers_sent() ) {
			nocache_headers();
			header( 'X-Robots-Tag: noindex, nofollow', true );
			header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0', true );
		}
	}

	private static function set_cookie( $value, $expires ) {
		if ( headers_sent() ) {
			return;
		}
		setcookie( self::COOKIE, $value, array(
			'expires'  => $expires,
			'path'     => COOKIEPATH ? COOKIEPATH : '/',
			'domain'   => COOKIE_DOMAIN ? COOKIE_DOMAIN : '',
			'secure'   => is_ssl(),
			'httponly' => true,
			'samesite' => 'Lax',
		) );
	}
}
