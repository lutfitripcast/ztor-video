-- Record the vendor's answer per license request so failures can be diagnosed without live tailing.
ALTER TABLE licenses ADD COLUMN upstream_status INTEGER;
ALTER TABLE licenses ADD COLUMN detail TEXT;
