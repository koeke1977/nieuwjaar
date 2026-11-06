-- Bewaar de tokenwaarde zodat actieve gezinslinks na herladen opnieuw beschikbaar zijn.
ALTER TABLE family_invites ADD COLUMN token_value TEXT;
