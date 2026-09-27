UPDATE organization_computers
SET name = substr(name, 1, 111) || substr(name, -9)
WHERE ownership = 'hosted'
  AND length(name) > 120
  AND substr(name, -9, 3) = ' · ';

UPDATE organization_computers
SET name = substr(name, 1, 120)
WHERE length(name) > 120;
