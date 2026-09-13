<?php
/**
 * Plugin Name: Faktory — Catalogue produits
 * Description: Catalogue de produits géré depuis l'administration : type de contenu « Produit », catégories, prix, disponibilité, mise en avant, bloc et shortcode d'affichage.
 * Version: 1.0.0
 * Requires at least: 6.5
 * Requires PHP: 8.1
 * Author: Partikuls
 * Text Domain: faktory-catalogue-produits
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'FAKTORY_CATALOGUE_PRODUITS_VERSION', '1.0.0' );
define( 'FAKTORY_CATALOGUE_PRODUITS_DIR', plugin_dir_path( __FILE__ ) );
define( 'FAKTORY_CATALOGUE_PRODUITS_URL', plugin_dir_url( __FILE__ ) );

require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/post-type.php';
require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/taxonomies.php';
require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/meta.php';
require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/admin-columns.php';
require_once FAKTORY_CATALOGUE_PRODUITS_DIR . 'includes/render.php';

function faktory_catalogue_produits_register_style(): void {
	wp_register_style( 'faktory-catalogue-produits', FAKTORY_CATALOGUE_PRODUITS_URL . 'style.css', array(), FAKTORY_CATALOGUE_PRODUITS_VERSION );
}
add_action( 'init', 'faktory_catalogue_produits_register_style', 9 );

function faktory_catalogue_produits_register_block(): void {
	register_block_type( FAKTORY_CATALOGUE_PRODUITS_DIR . 'blocks/catalogue-produits' );
}
add_action( 'init', 'faktory_catalogue_produits_register_block' );

/**
 * Shortcode équivalent du bloc : [faktory_catalogue_produits view="grid" limit="12" filter="1"].
 *
 * @param array<string, string>|string $atts
 */
function faktory_catalogue_produits_shortcode( $atts ): string {
	$args = shortcode_atts(
		array(
			'view'     => 'grid',
			'limit'    => '12',
			'filter'   => '1',
			'taxonomy' => '',
			'term'     => '',
		),
		is_array( $atts ) ? $atts : array(),
		'faktory_catalogue_produits'
	);
	return faktory_catalogue_produits_render(
		array(
			'view'     => $args['view'],
			'limit'    => (int) $args['limit'],
			'filter'   => in_array( $args['filter'], array( '1', 'true', 'yes' ), true ),
			'taxonomy' => $args['taxonomy'],
			'term'     => $args['term'],
		)
	);
}
add_shortcode( 'faktory_catalogue_produits', 'faktory_catalogue_produits_shortcode' );

function faktory_catalogue_produits_activate(): void {
	faktory_catalogue_produits_register_post_type();
	faktory_catalogue_produits_register_taxonomies();
	faktory_catalogue_produits_seed_terms();
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, 'faktory_catalogue_produits_activate' );
register_deactivation_hook( __FILE__, 'flush_rewrite_rules' );
