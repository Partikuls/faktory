( function ( wp ) {
	var el = wp.element.createElement;
	var InspectorControls = wp.blockEditor.InspectorControls;
	var PanelBody = wp.components.PanelBody;
	var SelectControl = wp.components.SelectControl;
	var RangeControl = wp.components.RangeControl;
	var ToggleControl = wp.components.ToggleControl;

	wp.blocks.registerBlockType( 'faktory/catalogue-produits', {
		edit: function ( props ) {
			var a = props.attributes;
			return el(
				wp.element.Fragment,
				null,
				el(
					InspectorControls,
					null,
					el(
						PanelBody,
						{ title: 'Affichage' },
						el( SelectControl, {
							label: 'Vue',
							value: a.view,
							options: [ { label: 'Grille', value: 'grid' }, { label: 'Mis en avant', value: 'featured' } ],
							onChange: function ( v ) { props.setAttributes( { view: v } ); }
						} ),
						el( RangeControl, {
							label: 'Nombre maximum',
							value: a.limit,
							min: 1,
							max: 48,
							onChange: function ( v ) { props.setAttributes( { limit: v } ); }
						} ),
						el( ToggleControl, {
							label: 'Filtres par catégorie',
							checked: !! a.filter,
							onChange: function ( v ) { props.setAttributes( { filter: v } ); }
						} )
					)
				),
				el( wp.serverSideRender, { block: 'faktory/catalogue-produits', attributes: a } )
			);
		},
		save: function () { return null; }
	} );
} )( window.wp );
