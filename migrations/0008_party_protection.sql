-- Party protection (2026-10-19): a party plays either the film's protected-URL version ('url', the default and the
-- version parties always used) or its DRM version ('drm'). The host chooses when creating the party.
ALTER TABLE parties ADD COLUMN protection TEXT NOT NULL DEFAULT 'url';
