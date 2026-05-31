-- ========================================
-- Unlimited Photos 365 — Schéma PostgreSQL
-- ========================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------
-- TABLE: users
-- ----------------------------------------
CREATE TABLE users (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    first_name  VARCHAR(100) NOT NULL,
    last_name   VARCHAR(100) NOT NULL,
    email       VARCHAR(255) UNIQUE NOT NULL,
    password    VARCHAR(255) NOT NULL,  -- bcrypt hash
    role        VARCHAR(20) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    avatar_url  TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- ----------------------------------------
-- TABLE: subscriptions
-- ----------------------------------------
CREATE TABLE subscriptions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plan            VARCHAR(20) NOT NULL CHECK (plan IN ('mensuel', 'annuel')),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'active', 'expired', 'refused', 'cancelled')),
    amount          DECIMAL(10,2) NOT NULL,
    start_date      DATE,
    end_date        DATE,
    confirmed_by    UUID REFERENCES users(id),  -- admin qui a confirmé
    confirmed_at    TIMESTAMP WITH TIME ZONE,
    refused_reason  TEXT,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_end_date ON subscriptions(end_date);

-- ----------------------------------------
-- TABLE: photos
-- ----------------------------------------
CREATE TABLE photos (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename        VARCHAR(500) NOT NULL,
    original_name   VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(100) NOT NULL,
    size_bytes      BIGINT NOT NULL,
    s3_key          VARCHAR(1000) NOT NULL,  -- clé S3
    s3_url          TEXT,                    -- URL présignée (temp)
    width           INTEGER,
    height          INTEGER,
    metadata        JSONB DEFAULT '{}',      -- EXIF, géolocalisation...
    is_deleted      BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_photos_user_id ON photos(user_id);
CREATE INDEX idx_photos_created_at ON photos(created_at DESC);
CREATE INDEX idx_photos_is_deleted ON photos(is_deleted);

-- ----------------------------------------
-- TABLE: payment_requests
-- ----------------------------------------
CREATE TABLE payment_requests (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES subscriptions(id),
    plan            VARCHAR(20) NOT NULL,
    amount          DECIMAL(10,2) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'confirmed', 'refused')),
    admin_id        UUID REFERENCES users(id),  -- admin traitant
    admin_note      TEXT,
    processed_at    TIMESTAMP WITH TIME ZONE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_payment_requests_user_id ON payment_requests(user_id);
CREATE INDEX idx_payment_requests_status ON payment_requests(status);

-- ----------------------------------------
-- TABLE: app_config
-- ----------------------------------------
CREATE TABLE app_config (
    key     VARCHAR(100) PRIMARY KEY,
    value   TEXT NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Config par défaut
INSERT INTO app_config (key, value) VALUES
    ('whatsapp_number', '+33612345678'),
    ('whatsapp_message_template', 'Bonjour, je souhaite prendre l''abonnement {plan} sur Unlimited Photos 365. Merci de m''envoyer les instructions de paiement.'),
    ('monthly_price', '10.00'),
    ('annual_price', '100.00'),
    ('storage_limit_gb', '0'),  -- 0 = illimité
    ('max_file_size_mb', '50');

-- ----------------------------------------
-- TABLE: refresh_tokens
-- ----------------------------------------
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       VARCHAR(500) NOT NULL,
    expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    is_revoked  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token ON refresh_tokens(token);

-- ----------------------------------------
-- TRIGGERS: updated_at automatique
-- ----------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_photos_updated_at BEFORE UPDATE ON photos
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payment_requests_updated_at BEFORE UPDATE ON payment_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ----------------------------------------
-- FUNCTION: Vérification expiration abonnement
-- ----------------------------------------
CREATE OR REPLACE FUNCTION check_subscription_expiry()
RETURNS void AS $$
BEGIN
    UPDATE subscriptions
    SET status = 'expired', updated_at = NOW()
    WHERE status = 'active'
      AND end_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- Exécuter la vérification (à appeler via cron)
-- SELECT check_subscription_expiry();

-- ----------------------------------------
-- VUE: Utilisateurs avec statut abonnement actuel
-- ----------------------------------------
CREATE VIEW user_subscription_status AS
SELECT
    u.id,
    u.first_name,
    u.last_name,
    u.email,
    u.role,
    u.created_at,
    s.plan,
    s.status AS subscription_status,
    s.start_date,
    s.end_date,
    (s.end_date - CURRENT_DATE) AS days_remaining,
    (SELECT COUNT(*) FROM photos p WHERE p.user_id = u.id AND NOT p.is_deleted) AS photo_count,
    (SELECT COALESCE(SUM(size_bytes), 0) FROM photos p WHERE p.user_id = u.id AND NOT p.is_deleted) AS storage_bytes
FROM users u
LEFT JOIN LATERAL (
    SELECT * FROM subscriptions s2
    WHERE s2.user_id = u.id
    ORDER BY s2.created_at DESC
    LIMIT 1
) s ON true
WHERE u.role = 'user';
