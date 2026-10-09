-- Which protected versions a film has: 'drm' (encrypted, vendor license) and/or 'url' (clear segments behind signed, expiring links).
-- Outputs: films/{id}/v{n}/ (drm) and films/{id}/v{n}/url/ (url).
ALTER TABLE films ADD COLUMN protections TEXT NOT NULL DEFAULT 'drm';
