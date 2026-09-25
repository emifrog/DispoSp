/* DispoSP — la proposition d'installation de Chrome, retenue dès le chargement.
 *
 * Chrome annonce qu'une page est installable par l'événement
 * « beforeinstallprompt », une demi-seconde environ après le chargement, et
 * de nouveau après une navigation. L'application ne l'écoutait que dans le
 * panneau de /profil : ailleurs, personne ne le retenait, et sur /profil même
 * le panneau n'existait souvent pas encore quand il passait. Le bouton
 * « Installer l'application » n'apparaissait donc presque jamais — et jamais
 * pour l'encadrement, dont le menu n'a pas de lien vers /profil.
 *
 * Ce script est chargé avant tout le reste (stratégie « beforeInteractive » de
 * la mise en page racine) : aucun événement ne peut passer avant lui. Il retient
 * le dernier, ce qui retire à Chrome sa propre bannière — l'application propose
 * désormais l'installation elle-même, sur l'écran de connexion et dans la barre
 * du haut de chaque écran — et prévient les composants qui l'attendent.
 *
 * Un fichier servi par l'application et non un script en ligne : la politique
 * de contenu n'a rien à autoriser de plus.
 */
(function () {
  var announce = function () {
    window.dispatchEvent(new Event("disposp:installation"));
  };
  window.__dispospInstallation = null;
  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    window.__dispospInstallation = event;
    announce();
  });
  window.addEventListener("appinstalled", function () {
    window.__dispospInstallation = null;
    announce();
  });
})();
