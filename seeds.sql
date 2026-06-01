-- ========================================
-- Unlimited Photos 365 — Données de test
-- ========================================

-- Admin (mot de passe: Admin!2024)
INSERT INTO users (id, first_name, last_name, email, password, role)
VALUES (
    'a0000000-0000-0000-0000-000000000001',
    'Admin', 'UP365',
    'admin@up365.com',
    '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewHaF0f3LDmDVeHS', -- Admin!2024
    'admin'
);

-- Utilisateur actif (mot de passe: Test!2024)
INSERT INTO users (id, first_name, last_name, email, password, role)
VALUES (
    'b0000000-0000-0000-0000-000000000001',
    'Marie', 'Dupont',
    'marie@exemple.com',
    '$2b$12$eImiTXuWVxfM37uY9l3BqeDumNjyWxvNKSNFGthklV5JqJb.dkOe6', -- Test!2024
    'user'
);

-- Abonnement actif pour Marie
INSERT INTO subscriptions (user_id, plan, status, amount, start_date, end_date, confirmed_at, confirmed_by)
VALUES (
    'b0000000-0000-0000-0000-000000000001',
    'annuel', 'active', 100.00,
    CURRENT_DATE - INTERVAL '30 days',
    CURRENT_DATE + INTERVAL '335 days',
    NOW() - INTERVAL '30 days',
    'a0000000-0000-0000-0000-000000000001'
);

-- Utilisateur en attente (mot de passe: Test!2024)
INSERT INTO users (id, first_name, last_name, email, password, role)
VALUES (
    'b0000000-0000-0000-0000-000000000002',
    'Jean', 'Martin',
    'jean@exemple.com',
    '$2b$12$eImiTXuWVxfM37uY9l3BqeDumNjyWxvNKSNFGthklV5JqJb.dkOe6',
    'user'
);

-- Demande en attente pour Jean
INSERT INTO subscriptions (user_id, plan, status, amount)
VALUES ('b0000000-0000-0000-0000-000000000002', 'mensuel', 'pending', 10.00);

INSERT INTO payment_requests (user_id, plan, amount, status)
VALUES ('b0000000-0000-0000-0000-000000000002', 'mensuel', 10.00, 'pending');

-- Utilisateur expiré (mot de passe: Test!2024)
INSERT INTO users (id, first_name, last_name, email, password, role)
VALUES (
    'b0000000-0000-0000-0000-000000000003',
    'Sophie', 'Bernard',
    'sophie@exemple.com',
    '$2b$12$eImiTXuWVxfM37uY9l3BqeDumNjyWxvNKSNFGthklV5JqJb.dkOe6',
    'user'
);

INSERT INTO subscriptions (user_id, plan, status, amount, start_date, end_date)
VALUES (
    'b0000000-0000-0000-0000-000000000003',
    'mensuel', 'expired', 10.00,
    CURRENT_DATE - INTERVAL '60 days',
    CURRENT_DATE - INTERVAL '30 days'
);

-- Quelques photos pour Marie
INSERT INTO photos (user_id, filename, original_name, mime_type, size_bytes, s3_key)
VALUES
    ('b0000000-0000-0000-0000-000000000001', 'vacances-corse.jpg', 'Vacances Corse.jpg', 'image/jpeg', 3355443, 'photos/b0000000.../vacances-corse.jpg'),
    ('b0000000-0000-0000-0000-000000000001', 'anniversaire.jpg', 'Anniversaire.jpg', 'image/jpeg', 2202010, 'photos/b0000000.../anniversaire.jpg'),
    ('b0000000-0000-0000-0000-000000000001', 'randonnee-alpes.jpg', 'Randonnée Alpes.jpg', 'image/jpeg', 5033164, 'photos/b0000000.../randonnee-alpes.jpg');
