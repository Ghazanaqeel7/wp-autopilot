<?php
defined( 'ABSPATH' ) || exit;

/**
 * Ed25519 request signing.
 *
 * Signed message (UTF-8, "\n" separated):
 *   METHOD \n ROUTE \n TIMESTAMP \n NONCE \n hex(sha256(raw body))
 * ROUTE is the REST route, e.g. "/autopilot/v1/health" (same for /wp-json/... and ?rest_route=...).
 * Headers: X-AP-Key-Id, X-AP-Timestamp, X-AP-Nonce, X-AP-Signature (base64, 64 bytes).
 */
class AP_Auth {
	const WINDOW     = 300;
	const MAX_FAILS  = 20;

	public static $actor = '';

	public static function conn() {
		$c = get_option( 'ap_bridge_conn' );
		return ( is_array( $c ) && ! empty( $c['public_key'] ) ) ? $c : null;
	}

	public static function ip() {
		return isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
	}

	/** permission_callback for every Autopilot route. */
	public static function check( WP_REST_Request $r ) {
		// Valid signatures always pass (shared CI IPs must never lock out the hub);
		// the limiter only stops failed-request floods from filling the audit log.
		$res = self::verify( $r );
		if ( is_wp_error( $res ) ) {
			$fail_key = 'ap_fail_' . md5( self::ip() );
			$fails    = (int) get_transient( $fail_key );
			if ( $fails >= self::MAX_FAILS ) {
				return new WP_Error( 'ap_rate_limited', 'Too many failed requests.', array( 'status' => 429 ) );
			}
			set_transient( $fail_key, $fails + 1, 10 * MINUTE_IN_SECONDS );
			AP_Store::audit( 'auth_failed', $r->get_route(), array( 'code' => $res->get_error_code() ), 'anonymous' );
			return $res;
		}
		return true;
	}

	public static function verify( WP_REST_Request $r ) {
		$c = self::conn();
		if ( ! $c ) {
			return self::deny( 'ap_not_connected', 'Site is not connected.', 403 );
		}
		if ( ! function_exists( 'sodium_crypto_sign_verify_detached' ) ) {
			return self::deny( 'ap_no_sodium', 'Sodium is not available.', 500 );
		}
		$kid   = (string) $r->get_header( 'x-ap-key-id' );
		$ts    = (string) $r->get_header( 'x-ap-timestamp' );
		$nonce = (string) $r->get_header( 'x-ap-nonce' );
		$sig   = base64_decode( (string) $r->get_header( 'x-ap-signature' ), true );

		if ( '' === $kid || ! hash_equals( (string) $c['key_id'], $kid ) ) {
			return self::deny( 'ap_bad_key', 'Unknown key.' );
		}
		if ( ! ctype_digit( $ts ) || abs( time() - (int) $ts ) > self::WINDOW ) {
			return self::deny( 'ap_bad_time', 'Timestamp outside window.' );
		}
		if ( ! preg_match( '/^[A-Za-z0-9_-]{16,64}$/', $nonce ) ) {
			return self::deny( 'ap_bad_nonce', 'Invalid nonce.' );
		}
		if ( false === $sig || 64 !== strlen( $sig ) ) {
			return self::deny( 'ap_bad_sig', 'Invalid signature.' );
		}
		$msg = implode( "\n", array( strtoupper( $r->get_method() ), $r->get_route(), $ts, $nonce, hash( 'sha256', (string) $r->get_body() ) ) );
		$pk  = base64_decode( (string) $c['public_key'], true );
		try {
			$ok = ( false !== $pk && 32 === strlen( $pk ) ) && sodium_crypto_sign_verify_detached( $sig, $msg, $pk );
		} catch ( Throwable $e ) {
			$ok = false;
		}
		if ( ! $ok ) {
			return self::deny( 'ap_bad_sig', 'Invalid signature.' );
		}
		if ( ! AP_Store::use_nonce( hash( 'sha256', $kid . '|' . $nonce ), time() + 2 * self::WINDOW ) ) {
			return self::deny( 'ap_replay', 'Nonce already used.' );
		}
		self::$actor = 'hub:' . $kid;
		return true;
	}

	/**
	 * Connection code = base64(JSON {v, site_id, key_id, public_key, hub}).
	 * @return array|WP_Error
	 */
	public static function parse_code( $code ) {
		$json = base64_decode( trim( (string) $code ), true );
		$data = $json ? json_decode( $json, true ) : null;
		if ( ! is_array( $data ) || 1 !== (int) ( $data['v'] ?? 0 ) ) {
			return new WP_Error( 'ap_code', 'Invalid connection code.' );
		}
		$pk = base64_decode( (string) ( $data['public_key'] ?? '' ), true );
		if ( false === $pk || 32 !== strlen( $pk ) ) {
			return new WP_Error( 'ap_code', 'Invalid public key in connection code.' );
		}
		foreach ( array( 'site_id', 'key_id' ) as $k ) {
			if ( empty( $data[ $k ] ) || ! preg_match( '/^[a-z0-9-]{2,64}$/', (string) $data[ $k ] ) ) {
				return new WP_Error( 'ap_code', "Invalid $k in connection code." );
			}
		}
		return array(
			'site_id'      => $data['site_id'],
			'key_id'       => $data['key_id'],
			'public_key'   => $data['public_key'],
			'hub'          => sanitize_text_field( (string) ( $data['hub'] ?? 'WP Autopilot' ) ),
			'connected_at' => gmdate( 'c' ),
		);
	}

	private static function deny( $code, $msg, $status = 401 ) {
		return new WP_Error( $code, $msg, array( 'status' => $status ) );
	}
}
