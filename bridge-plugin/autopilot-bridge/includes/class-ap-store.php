<?php
defined( 'ABSPATH' ) || exit;

/**
 * Tables, audit log and replay-protection nonces.
 */
class AP_Store {
	const DB_VERSION = '1';

	public static function t( $name ) {
		global $wpdb;
		return $wpdb->prefix . 'ap_' . $name;
	}

	public static function install() {
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		$c = $wpdb->get_charset_collate();

		dbDelta( 'CREATE TABLE ' . self::t( 'audit' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			ts datetime NOT NULL,
			actor varchar(64) NOT NULL DEFAULT '',
			action varchar(64) NOT NULL DEFAULT '',
			object varchar(191) NOT NULL DEFAULT '',
			detail longtext NULL,
			ip varchar(45) NOT NULL DEFAULT '',
			PRIMARY KEY  (id),
			KEY ts (ts)
		) $c;" );

		dbDelta( 'CREATE TABLE ' . self::t( 'nonces' ) . " (
			nonce char(64) NOT NULL,
			expires int(10) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (nonce),
			KEY expires (expires)
		) $c;" );

		dbDelta( 'CREATE TABLE ' . self::t( 'changesets' ) . " (
			id varchar(64) NOT NULL,
			status varchar(20) NOT NULL DEFAULT 'staged',
			created datetime NOT NULL,
			updated datetime NOT NULL,
			ops longtext NULL,
			overlay longtext NULL,
			base longtext NULL,
			created_posts longtext NULL,
			preview_hash char(64) NOT NULL DEFAULT '',
			preview_expires int(10) unsigned NOT NULL DEFAULT 0,
			snapshot_id bigint(20) unsigned NOT NULL DEFAULT 0,
			PRIMARY KEY  (id),
			KEY preview_hash (preview_hash)
		) $c;" );

		dbDelta( 'CREATE TABLE ' . self::t( 'snapshots' ) . " (
			id bigint(20) unsigned NOT NULL AUTO_INCREMENT,
			changeset varchar(64) NOT NULL DEFAULT '',
			created datetime NOT NULL,
			data longtext NULL,
			PRIMARY KEY  (id),
			KEY changeset (changeset)
		) $c;" );

		update_option( 'ap_bridge_db', self::DB_VERSION, false );
	}

	public static function uninstall() {
		global $wpdb;
		foreach ( array( 'audit', 'nonces', 'changesets', 'snapshots' ) as $t ) {
			$wpdb->query( 'DROP TABLE IF EXISTS ' . self::t( $t ) ); // phpcs:ignore
		}
		foreach ( array( 'ap_bridge_db', 'ap_bridge_conn', 'ap_bridge_paused', 'ap_bridge_css', 'ap_bridge_snippets', 'ap_bridge_snippets_off', 'ap_bridge_code_mode', 'ap_bridge_plugin_allow' ) as $o ) {
			delete_option( $o );
		}
	}

	public static function audit( $action, $object = '', $detail = array(), $actor = null ) {
		global $wpdb;
		if ( null === $actor ) {
			$actor = AP_Auth::$actor;
			if ( '' === $actor && is_user_logged_in() ) {
				$actor = 'admin:' . wp_get_current_user()->user_login;
			}
		}
		$wpdb->insert(
			self::t( 'audit' ),
			array(
				'ts'     => current_time( 'mysql', true ),
				'actor'  => substr( (string) $actor, 0, 64 ),
				'action' => substr( (string) $action, 0, 64 ),
				'object' => substr( (string) $object, 0, 191 ),
				'detail' => $detail ? wp_json_encode( $detail ) : null,
				'ip'     => substr( AP_Auth::ip(), 0, 45 ),
			)
		);
	}

	public static function recent_audit( $limit = 50 ) {
		global $wpdb;
		$limit = max( 1, min( 500, (int) $limit ) );
		return $wpdb->get_results( 'SELECT ts, actor, action, object, detail FROM ' . self::t( 'audit' ) . " ORDER BY id DESC LIMIT $limit", ARRAY_A ); // phpcs:ignore
	}

	/** Returns false if the nonce was already used (replay). */
	public static function use_nonce( $hash, $expires ) {
		global $wpdb;
		$table = self::t( 'nonces' );
		if ( 0 === wp_rand( 0, 50 ) ) {
			$wpdb->query( $wpdb->prepare( "DELETE FROM $table WHERE expires < %d", time() ) ); // phpcs:ignore
		}
		$exists = $wpdb->get_var( $wpdb->prepare( "SELECT nonce FROM $table WHERE nonce = %s", $hash ) ); // phpcs:ignore
		if ( $exists ) {
			return false;
		}
		$prev = $wpdb->suppress_errors( true );
		$ok   = $wpdb->insert( $table, array( 'nonce' => $hash, 'expires' => (int) $expires ) );
		$wpdb->suppress_errors( $prev );
		return (bool) $ok;
	}
}
