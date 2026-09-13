<?php
if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

const FAKTORY_CATALOGUE_PRODUITS_POST_TYPE = 'produit';

function faktory_catalogue_produits_register_post_type(): void {
	register_post_type(
		FAKTORY_CATALOGUE_PRODUITS_POST_TYPE,
		array(
			'labels'        => array(
				'name'               => 'Produits',
				'singular_name'      => 'Produit',
				'menu_name'          => 'Produits',
				'all_items'          => 'Tous les produits',
				'add_new'            => 'Ajouter',
				'add_new_item'       => 'Ajouter un produit',
				'edit_item'          => 'Modifier le produit',
				'new_item'           => 'Nouveau produit',
				'view_item'          => 'Voir le produit',
				'search_items'       => 'Rechercher un produit',
				'not_found'          => 'Aucun produit',
				'not_found_in_trash' => 'Aucun produit dans la corbeille',
			),
			'public'        => true,
			'show_in_rest'  => true,
			'has_archive'   => false,
			'menu_position' => 20,
			'menu_icon'     => 'dashicons-carrot',
			'supports'      => array( 'title', 'editor', 'thumbnail' ),
			'rewrite'       => array( 'slug' => 'produit' ),
		)
	);
}
add_action( 'init', 'faktory_catalogue_produits_register_post_type' );
