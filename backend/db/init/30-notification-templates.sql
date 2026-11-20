INSERT INTO notification_templates (event_key, channel, locale, subject_template, body_template, enabled, created_at, updated_at)
VALUES
  ('demande_soumise', 'email', 'fr', 'Nouvelle demande à approuver — {reference}', 'La demande {reference} ({title}) du magasin {store}, d’un montant de {amount} MAD, a été soumise par {actor}. Elle attend l’approbation CDG. Lien : {link}', true, NOW(), NOW()),
  ('demande_soumise', 'internal', 'fr', 'Nouvelle demande à approuver — {reference}', 'La demande {reference} ({title}) du magasin {store} attend l’approbation CDG. Lien : {link}', true, NOW(), NOW()),
  ('validation_cdg', 'email', 'fr', 'Demande approuvée par CDG — {reference}', 'La demande {reference} ({title}) a été approuvée par {actor}. Elle attend maintenant l’approbation {next_role}. Commentaire : {comment}. Lien : {link}', true, NOW(), NOW()),
  ('validation_cdg', 'internal', 'fr', 'Demande approuvée par CDG — {reference}', 'La demande {reference} ({title}) attend l’approbation {next_role}. Lien : {link}', true, NOW(), NOW()),
  ('validation_dd', 'email', 'fr', 'Demande approuvée par DD — {reference}', 'La demande {reference} ({title}) a été approuvée par {actor}. Elle attend maintenant l’approbation DG. Commentaire : {comment}. Lien : {link}', true, NOW(), NOW()),
  ('validation_dd', 'internal', 'fr', 'Demande approuvée par DD — {reference}', 'La demande {reference} ({title}) attend l’approbation DG. Lien : {link}', true, NOW(), NOW()),
  ('validation_finale_dg', 'email', 'fr', 'Demande approuvée par DG — {reference}', 'La demande {reference} ({title}), d’un montant de {amount} MAD, a été approuvée par {actor}. Le demandeur {demandeur} est informé. Lien : {link}', true, NOW(), NOW()),
  ('validation_finale_dg', 'internal', 'fr', 'Demande approuvée par DG — {reference}', 'La demande {reference} ({title}) est approuvée. Lien : {link}', true, NOW(), NOW()),
  ('rejet_correction', 'email', 'fr', 'Demande rejetée — {reference}', 'La demande {reference} ({title}) a été rejetée par {actor}. Motif : {reason}. Lien : {link}', true, NOW(), NOW()),
  ('rejet_correction', 'internal', 'fr', 'Demande rejetée — {reference}', 'La demande {reference} ({title}) a été rejetée par {actor}. Motif : {reason}. Lien : {link}', true, NOW(), NOW()),
  ('depassement_retard', 'email', 'fr', 'Risque ou retard — {reference}', 'Risque {reference} — sévérité {severity} — magasin {store}. Action attendue : {action}. Lien : {link}', true, NOW(), NOW()),
  ('depassement_retard', 'internal', 'fr', 'Risque ou retard — {reference}', 'Risque {reference} — sévérité {severity} — magasin {store}. Lien : {link}', true, NOW(), NOW()),
  ('modification_date_ouverture', 'email', 'fr', 'Modification de la date d’ouverture — {reference}', 'Ancienne date {previous_date}, nouvelle date {new_date}, motif : {reason}. Lien : {link}', true, NOW(), NOW()),
  ('modification_date_ouverture', 'internal', 'fr', 'Modification de la date d’ouverture — {reference}', 'Ancienne date {previous_date}, nouvelle date {new_date}, motif : {reason}. Lien : {link}', true, NOW(), NOW())
ON CONFLICT (event_key, channel, locale) DO UPDATE
SET subject_template = EXCLUDED.subject_template,
    body_template = EXCLUDED.body_template,
    enabled = true,
    deleted_at = NULL,
    updated_at = NOW();
