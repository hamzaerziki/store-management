export const ROLE_DEFINITIONS = [
  {
    code: 'admin',
    name: 'Administrateur',
    tone: 'emerald',
    mission: 'Pilote la configuration globale et garantit la cohérence du dispositif.',
    duties: [
      'Créer les magasins et paramétrer les dates d’ouverture',
      'Gérer les utilisateurs et les accès',
      'Administrer le catalogue, les catégories et les modèles d’articles',
      'Consulter tous les devis, tableaux de bord, audits et forcer un signal magasin',
    ],
    boundary: 'Ne remplace pas les validations CDG/DD/DG : il prépare et contrôle le système.',
  },
  {
    code: 'IT',
    name: 'Équipe Informatique',
    tone: 'blue',
    mission: 'Livrable technique : terminaux, réseau, serveurs, impressions et signalétique technique.',
    duties: [
      'Construire et suivre la checklist des articles IT',
      'Téléverser les devis PDF pour ses articles',
      'Extraire automatiquement les montants, délais et garanties depuis les devis',
      'Préparer les comparatifs IT et les soumettre au comité',
    ],
    boundary: 'Voit uniquement ses articles IT ; ne valide pas financièrement.',
  },
  {
    code: 'MG',
    name: 'Magasin',
    tone: 'gold',
    mission: 'Livrable commercial : mobilier, équipement, sécurité, fournitures et signalétique.',
    duties: [
      'Construire et suivre la checklist des articles MG',
      'Téléverser les devis PDF pour ses articles',
      'Extraire automatiquement les données des devis',
      'Préparer les comparatifs MG et les soumettre au comité',
    ],
    boundary: 'Voit uniquement ses articles MG ; ne valide pas financièrement.',
  },
  {
    code: 'CDG',
    name: 'Contrôle de Gestion',
    tone: 'amber',
    mission: 'Premier niveau de validation financière et de cohérence budgétaire.',
    duties: [
      'Consulter les devis et les tableaux comparatifs',
      'Vérifier le prix, le délai, la garantie et la justification',
      'Approuver ou rejeter les comparatifs en attente CDG',
      'Transmettre chaque dossier approuvé à la Direction Développement',
    ],
    boundary: 'Ne téléverse pas de devis et ne modifie pas les articles.',
  },
  {
    code: 'DD',
    name: 'DD — Direction Développement',
    tone: 'blue',
    mission: 'Valide les demandes IT et MG après contrôle de gestion, puis les transmet à la Direction Générale.',
    duties: [
      'Consulter les demandes, comparatifs et risques des départements IT et MG',
      'Vérifier la cohérence technique, commerciale et calendaire des dossiers',
      'Approuver ou rejeter les dossiers IT et MG en attente DD',
      'Transmettre les dossiers approuvés à la Direction Générale',
    ],
    boundary: 'Le même rôle DD couvre les deux départements IT et MG.',
  },
  {
    code: 'DG',
    name: 'Direction Générale',
    tone: 'violet',
    mission: 'Décision finale et arbitrage des engagements.',
    duties: [
      'Consulter tous les tableaux de bord, devis, comparatifs et audits',
      'Approuver ou rejeter les comparatifs en attente DG',
      'Donner l’autorisation finale avant engagement et ouverture',
      'Suivre la progression globale des ouvertures',
    ],
    boundary: 'Intervient uniquement sur les dossiers présentés par la Direction Développement.',
  },
];

export const WORKFLOW_STEPS = [
  { label: 'IT / MG', text: 'Préparent la checklist et téléversent les devis PDF.' },
  { label: 'Système', text: 'Extrait montants, délais, validité et garantie, puis génère le comparatif.' },
  { label: 'CDG', text: 'Valide la cohérence financière et transmet le dossier.' },
  { label: 'DD', text: 'Valide la cohérence projet et planning, puis transmet le dossier.' },
  { label: 'DG', text: 'Donne l’approbation finale avant engagement.' },
];
