import Image from "next/image";

// Une image ne se recolore pas : chaque surface a son fichier. Sur fond clair, le
// mot-symbole à fond transparent ; sur la barre latérale, la version livrée sur
// sa plaque bleu nuit, dont la teinte est exactement celle de --navy — la plaque
// se confond donc avec la barre, et aucune bordure n'apparaît.
//
// Les deux fichiers n'ont pas les mêmes proportions : chacun porte les siennes
// plutôt qu'un ratio commun qui déformerait l'autre.
const assets = {
  onLight: { src: "/logo-disposp.png", width: 1521, height: 486 },
  onDark: { src: "/logo-disposp-sombre.png", width: 1800, height: 850 },
} as const;

export function Brand({ variant = "onLight", width = 176 }: { variant?: keyof typeof assets; width?: number }) {
  const asset = assets[variant];
  return (
    <Image
      className="brand"
      src={asset.src}
      alt="DispoSP — disponibilités, planification, cohésion"
      width={width}
      height={Math.round((width * asset.height) / asset.width)}
      priority
    />
  );
}

/** Le symbole seul, carré. Là où la largeur manque — la barre du haut d'un
    téléphone — il dit la même chose que le mot en quatre fois moins de place. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return <Image className="brand-mark" src="/symbole-disposp.png" alt="DispoSP" width={size} height={size} priority />;
}
