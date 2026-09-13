<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * @return array<string, array{singular: string, plural: string, terms: list<string>}>
 */
function faktory_catalogue_produits_taxonomies(): array {
	return array(
		'categorie_produit' => array(
			'singular' => 'Catégorie',
			'plural'   => 'Catégories',
			'terms'    => array( 'Pains', 'Viennoiseries', 'Pâtisseries', 'Salé du midi' ),
		),
	);
}

function faktory_catalogue_produits_register_taxonomies(): void {
	foreach ( faktory_catalogue_produits_taxonomies() as $slug => $tax ) {
		register_taxonomy(
			$slug,
			FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
			array(
				'labels'            => array(
					'name'          => $tax['plural'],
					'singular_name' => $tax['singular'],
					'menu_name'     => $tax['plural'],
				),
				'hierarchical'      => true,
				'show_in_rest'      => true,
				'show_admin_column' => true,
				'rewrite'           => array( 'slug' => str_replace( '_', '-', $slug ) ),
			)
		);
	}
}
add_action( 'init', 'faktory_catalogue_produits_register_taxonomies', 11 );

/** Crée les termes prévus par la spec s'ils manquent (appelé à l'activation). */
function faktory_catalogue_produits_seed_terms(): void {
	foreach ( faktory_catalogue_produits_taxonomies() as $slug => $tax ) {
		foreach ( $tax['terms'] as $name ) {
			if ( null === term_exists( $name, $slug ) ) {
				wp_insert_term( $name, $slug );
			}
		}
	}
}
