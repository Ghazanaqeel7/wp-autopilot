<?php
defined( 'ABSPATH' ) || exit;

/**
 * Read-only views of the site, kept compact for token economy.
 */
class AP_Inventory {
	const TYPES = array( 'page', 'elementor_library', 'wp_template', 'wp_template_part' );

	const CACHE_PLUGINS = array( 'litespeed-cache', 'wp-rocket', 'w3-total-cache', 'wp-super-cache', 'wp-fastest-cache', 'sg-cachepress', 'breeze', 'autoptimize', 'cache-enabler', 'nitropack', 'hummingbird-performance', 'wp-optimize', 'swift-performance-lite' );
	const SEC_PLUGINS   = array( 'wordfence', 'better-wp-security', 'sucuri-scanner', 'all-in-one-wp-security-and-firewall', 'ninjafirewall', 'defender-security', 'wp-simple-firewall', 'solid-security' );
	const SEO_PLUGINS   = array( 'wordpress-seo', 'seo-by-rank-math', 'all-in-one-seo-pack' );

	public static function health() {
		$c = AP_Auth::conn();
		return array(
			'plugin'    => AP_BRIDGE_VERSION,
			'site_id'   => $c['site_id'] ?? null,
			'paused'    => (bool) get_option( 'ap_bridge_paused' ),
			'time'      => time(),
			'wp'        => get_bloginfo( 'version' ),
			'php'       => PHP_VERSION,
			'https'     => is_ssl() || 0 === strpos( home_url(), 'https://' ),
			'sodium'    => function_exists( 'sodium_crypto_sign_verify_detached' ),
			'file_mods' => ! ( defined( 'DISALLOW_FILE_MODS' ) && DISALLOW_FILE_MODS ),
			'code_mode' => AP_Functions::mode(),
		);
	}

	public static function site() {
		require_once ABSPATH . 'wp-admin/includes/plugin.php';
		$active  = (array) get_option( 'active_plugins', array() );
		$plugins = array();
		$slugs   = array();
		foreach ( get_plugins() as $file => $p ) {
			$slug      = dirname( $file );
			$slug      = '.' === $slug ? basename( $file, '.php' ) : $slug;
			$on        = in_array( $file, $active, true );
			$plugins[] = array( 'slug' => $slug, 'version' => $p['Version'], 'active' => $on );
			if ( $on ) {
				$slugs[] = $slug;
			}
		}
		$theme = wp_get_theme();
		return array(
			'name'       => get_bloginfo( 'name' ),
			'url'        => home_url( '/' ),
			'health'     => self::health(),
			'theme'      => array(
				'name'    => $theme->get( 'Name' ),
				'version' => $theme->get( 'Version' ),
				'parent'  => $theme->parent() ? $theme->parent()->get( 'Name' ) : null,
				'block'   => function_exists( 'wp_is_block_theme' ) && wp_is_block_theme(),
			),
			'builders'   => self::builders( $theme ),
			'cache'      => array_values( array_intersect( $slugs, self::CACHE_PLUGINS ) ),
			'security'   => array_values( array_intersect( $slugs, self::SEC_PLUGINS ) ),
			'seo'        => array_values( array_intersect( $slugs, self::SEO_PLUGINS ) ),
			'permalinks' => (string) get_option( 'permalink_structure' ),
			'plugins'    => $plugins,
			'pages'      => self::pages(),
			'menus'      => array_map( function ( $m ) {
				return array( 'id' => $m->term_id, 'name' => $m->name, 'count' => $m->count );
			}, wp_get_nav_menus() ),
			'counts'     => array( 'posts' => (int) wp_count_posts( 'post' )->publish ),
		);
	}

	private static function builders( $theme ) {
		$b = array();
		if ( defined( 'ELEMENTOR_VERSION' ) ) {
			$b['elementor'] = ELEMENTOR_VERSION;
		}
		if ( defined( 'ELEMENTOR_PRO_VERSION' ) ) {
			$b['elementor_pro'] = ELEMENTOR_PRO_VERSION;
		}
		if ( defined( 'WPB_VC_VERSION' ) ) {
			$b['wpbakery'] = WPB_VC_VERSION;
		}
		if ( defined( 'BRICKS_VERSION' ) ) {
			$b['bricks'] = BRICKS_VERSION;
		}
		if ( defined( 'FL_BUILDER_VERSION' ) ) {
			$b['beaver'] = FL_BUILDER_VERSION;
		}
		if ( defined( 'ET_BUILDER_VERSION' ) || 'Divi' === $theme->get_template() ) {
			$b['divi'] = defined( 'ET_BUILDER_VERSION' ) ? ET_BUILDER_VERSION : 'theme';
		}
		$b['gutenberg'] = get_bloginfo( 'version' );
		return $b;
	}

	public static function pages() {
		$out = array();
		$q   = get_posts( array(
			'post_type'      => self::TYPES,
			'post_status'    => array( 'publish', 'draft', 'private' ),
			'posts_per_page' => 500,
			'orderby'        => 'menu_order title',
			'order'          => 'ASC',
			'no_found_rows'  => true,
		) );
		foreach ( $q as $p ) {
			$out[] = array(
				'id'        => $p->ID,
				'type'      => $p->post_type,
				'title'     => $p->post_title,
				'slug'      => $p->post_name,
				'status'    => $p->post_status,
				'url'       => 'publish' === $p->post_status ? get_permalink( $p ) : null,
				'builder'   => self::builder_of( $p ),
				'tpl'       => get_post_meta( $p->ID, '_elementor_template_type', true ) ?: get_post_meta( $p->ID, '_wp_page_template', true ),
				'modified'  => $p->post_modified_gmt,
				'data_hash' => self::data_hash( $p ),
			);
		}
		return $out;
	}

	/** One page in detail. $full=false returns an outline only. */
	public static function page( $post_id, $full = false ) {
		$p = get_post( (int) $post_id );
		if ( ! $p ) {
			return new WP_Error( 'ap_not_found', 'Post not found.', array( 'status' => 404 ) );
		}
		$builder = self::builder_of( $p );
		$out     = array(
			'id'        => $p->ID,
			'type'      => $p->post_type,
			'title'     => $p->post_title,
			'status'    => $p->post_status,
			'builder'   => $builder,
			'data_hash' => self::data_hash( $p ),
		);
		if ( 'elementor' === $builder ) {
			$json            = (string) get_post_meta( $p->ID, '_elementor_data', true );
			$out['elements'] = $full ? json_decode( $json, true ) : AP_Adapter_Elementor::outline( $json );
			$out['settings'] = $full ? get_post_meta( $p->ID, '_elementor_page_settings', true ) : null;
		} elseif ( 'gutenberg' === $builder ) {
			$out['blocks'] = $full ? $p->post_content : AP_Adapter_Gutenberg::outline( $p->post_content );
		} else {
			$out['content'] = $full ? $p->post_content : mb_substr( wp_strip_all_tags( $p->post_content ), 0, 600 );
		}
		return $out;
	}

	public static function builder_of( $p ) {
		if ( AP_Adapter_Elementor::is_elementor( $p->ID ) ) {
			return 'elementor';
		}
		return has_blocks( $p->post_content ) ? 'gutenberg' : 'classic';
	}

	/** Hash of the data an edit targets; used as expect_before_hash. */
	public static function data_hash( $p ) {
		$data = AP_Adapter_Elementor::is_elementor( $p->ID ) ? (string) get_post_meta( $p->ID, '_elementor_data', true ) : (string) $p->post_content;
		return hash( 'sha256', $data );
	}
}
