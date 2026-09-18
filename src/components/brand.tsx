import Image from "next/image";

// Le mot-symbole existe en deux versions parce qu'une image ne se recolore pas :
// bleu nuit sur les fonds clairs, blanc sur la barre latérale. Les proportions
// sont celles du fichier fourni, 936 × 214.
const RATIO = 214 / 936;

export function Brand({ tone = "navy", width = 176 }: { tone?: "navy" | "light"; width?: number }) {
  return (
    <Image
      className="brand"
      src={tone === "light" ? "/logo-disposp-blanc.png" : "/logo-disposp.png"}
      alt="DispoSP — disponibilités, planification, cohésion"
      width={width}
      height={Math.round(width * RATIO)}
      priority
    />
  );
}

/** Le symbole seul, carré. Là où la largeur manque — la barre du haut d'un
    téléphone — il dit la même chose que le mot en quatre fois moins de place. */
export function BrandMark({ size = 28 }: { size?: number }) {
  return <Image className="brand-mark" src="/symbole-disposp.png" alt="DispoSP" width={size} height={size} priority />;
}
