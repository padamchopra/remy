CREATE TABLE IF NOT EXISTS computer_model_keys (
  computer_id TEXT NOT NULL,
  name TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (computer_id, name)
);
