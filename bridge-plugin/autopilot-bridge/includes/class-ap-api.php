<?php
defined( 'ABSPATH' ) || exit;

/**
 * REST API: namespace autopilot/v1. Every route is POST + JSON body + Ed25519 signature.
 */
class AP_API {
	const NS = 'autopilot/v1';

	public static function init() {
		add_action( 'rest_api_init', array( __CLASS__, 'routes' ) );
	}

	public static function routes() {
		$read  = array(
			'health'    => array( 'AP_Inventory', 'health' ),
			'inventory' => array( __CLASS__, 'inventory' ),
			'page'      => array( __CLASS__, 'page' ),
			'changeset' => array( __CLASS__, 'changeset_get' ),
			'audit'     => array( __CLASS__, 'audit' ),
		);
		$write = array(
			'changeset/stage'   => array( __CLASS__, 'stage' ),
			'changeset/preview' => array( __CLASS__, 'preview' ),
			'changeset/promote' => array( __CLASS__, 'promote' ),
			'changeset/discard' => array( __CLASS__, 'discard' ),
			'snapshot/restore'  => array( __CLASS__, 'restore' ),
		);
		foreach ( $read as $route => $cb ) {
			self::register( $route, $cb, false );
		}
		foreach ( $write as $route => $cb ) {
			self::register( $route, $cb, true );
		}
	}

	private static function register( $route, $cb, $mutating ) {
		register_rest_route( self::NS, '/' . $route, array(
			'methods'             => 'POST',
			'permission_callback' => array( 'AP_Auth', 'check' ),
			'callback'            => function ( WP_REST_Request $r ) use ( $cb, $mutating, $route ) {
				if ( $mutating && get_option( 'ap_bridge_paused' ) ) {
					return new WP_Error( 'ap_paused', 'Autopilot is paused on this site.', array( 'status' => 423 ) );
				}
				$body = json_decode( (string) $r->get_body(), true );
				$body = is_array( $body ) ? $body : array();
				try {
					$res = call_user_func( $cb, $body );
				} catch ( Throwable $e ) {
					AP_Store::audit( 'error', $route, array( 'message' => $e->getMessage() ) );
					return new WP_Error( 'ap_error', 'Internal error: ' . $e->getMessage(), array( 'status' => 500 ) );
				}
				return is_wp_error( $res ) ? $res : rest_ensure_response( $res );
			},
		) );
	}

	public static function inventory( $b ) {
		return AP_Inventory::site();
	}

	public static function page( $b ) {
		return AP_Inventory::page( (int) ( $b['post_id'] ?? 0 ), ! empty( $b['full'] ) );
	}

	public static function changeset_get( $b ) {
		return AP_Changesets::summary( (string) ( $b['changeset'] ?? '' ) );
	}

	public static function audit( $b ) {
		return AP_Store::recent_audit( (int) ( $b['limit'] ?? 50 ) );
	}

	public static function stage( $b ) {
		return AP_Changesets::stage( (string) ( $b['changeset'] ?? '' ), $b['ops'] ?? array(), (int) ( $b['ttl_hours'] ?? 72 ) );
	}

	public static function preview( $b ) {
		return AP_Changesets::new_token( (string) ( $b['changeset'] ?? '' ), (int) ( $b['ttl_hours'] ?? 72 ) );
	}

	public static function promote( $b ) {
		return AP_Changesets::promote( (string) ( $b['changeset'] ?? '' ) );
	}

	public static function discard( $b ) {
		return AP_Changesets::discard( (string) ( $b['changeset'] ?? '' ) );
	}

	public static function restore( $b ) {
		return AP_Changesets::restore( (int) ( $b['snapshot_id'] ?? 0 ) );
	}
}
