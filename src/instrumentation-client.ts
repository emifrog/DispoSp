import { z } from "zod";

// S'exécute dans le navigateur avant que l'application ne devienne interactive.
//
// Zod essaie `new Function` au premier `parse` pour compiler ses schémas. La
// politique de contenu (next.config.ts) refuse eval, et le navigateur signale
// l'essai comme une violation même quand Zod l'attrape. Sans compilation, Zod
// valide exactement de la même façon — un peu moins vite, sur des formulaires.
z.config({ jitless: true });
