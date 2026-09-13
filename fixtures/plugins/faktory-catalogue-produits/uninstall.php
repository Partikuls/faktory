<?php
/**
 * Désinstallation : supprime les produits, les termes et leurs meta.
 */
if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

// Le plugin n'est pas chargé pendant la désinstallation : on ré-enregistre le type de contenu pour pouvoir lister ses entrées.
register_post_type( 'produit' );
$faktory_catalogue_produits_post_ids = get_posts(
	array(
		'post_type'      => 'produit',
		'post_status'    => 'any',
		'posts_per_page' => -1,
		'fields'         => 'ids',
	)
);
foreach ( $faktory_catalogue_produits_post_ids as $faktory_catalogue_produits_post_id ) {
	if ( is_int( $faktory_catalogue_produits_post_id ) ) {
		wp_delete_post( $faktory_catalogue_produits_post_id, true );
	}
}

// Le plugin n'est pas chargé pendant la désinstallation : on ré-enregistre la taxonomie pour pouvoir lister ses termes.
register_taxonomy( 'categorie_produit', 'produit' );
$faktory_catalogue_produits_term_ids = get_terms(
	array(
		'taxonomy'   => 'categorie_produit',
		'hide_empty' => false,
		'fields'     => 'ids',
	)
);
if ( is_array( $faktory_catalogue_produits_term_ids ) ) {
	foreach ( $faktory_catalogue_produits_term_ids as $faktory_catalogue_produits_term_id ) {
		if ( is_int( $faktory_catalogue_produits_term_id ) ) {
			wp_delete_term( $faktory_catalogue_produits_term_id, 'categorie_produit' );
		}
	}
}
