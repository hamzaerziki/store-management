UPDATE stores
SET state_reason = NULL
WHERE state_reason LIKE 'Étape Préouverture supprimée%';
