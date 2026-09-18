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
