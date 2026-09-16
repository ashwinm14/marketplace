-- Supabase Schema for Market Place Game

-- 1. Game State Table (Single Row)
CREATE TABLE IF NOT EXISTS game_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    current_phase TEXT NOT NULL DEFAULT 'SETUP', -- SETUP, INTRO, BUILDING, PITCHING, MARKET, END
    timer_ends_at TIMESTAMPTZ,
    timer_duration_ms BIGINT DEFAULT 0,
    is_paused BOOLEAN DEFAULT true,
    active_buzzer_team_id UUID,
    active_buzzer_timestamp TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial state
INSERT INTO game_state (current_phase) VALUES ('SETUP');

-- 2. Teams Table
CREATE TABLE IF NOT EXISTS teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    pin_code TEXT NOT NULL UNIQUE,
    balance INTEGER NOT NULL DEFAULT 1000,
    items_built INTEGER DEFAULT 0,
    items_sold INTEGER DEFAULT 0,
    items_bought INTEGER DEFAULT 0,
    score_building INTEGER DEFAULT 0,
    score_pitching INTEGER DEFAULT 0,
    score_market_sell INTEGER DEFAULT 0,
    score_market_buy INTEGER DEFAULT 0,
    rank_points INTEGER DEFAULT 0,
    has_buzzed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Safe alter for existing tables
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='teams' AND column_name='has_buzzed') THEN
        ALTER TABLE teams ADD COLUMN has_buzzed BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 3. Products Table
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    price INTEGER NOT NULL DEFAULT 0,
    is_sold BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Transactions Table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    seller_team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    amount INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Notifications Table
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'info',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Set up Realtime for tables safely
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'game_state') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE game_state;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'teams') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE teams;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'products') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE products;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'transactions') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE transactions;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'notifications') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
    END IF;
END $$;


-- 5. RPC Function for Safe Buying
CREATE OR REPLACE FUNCTION process_buy_transaction(p_buyer_id UUID, p_product_id UUID, p_amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    v_product RECORD;
    v_buyer RECORD;
    v_seller RECORD;
    v_existing RECORD;
BEGIN
    -- 0. Prevent buying same product twice
    SELECT * INTO v_existing FROM transactions WHERE buyer_team_id = p_buyer_id AND product_id = p_product_id;
    IF FOUND THEN
        RAISE EXCEPTION 'You have already bought this product.';
    END IF;

    -- 1. Get Product info and lock the row
    SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found';
    END IF;

    -- 2. Prevent buying from own team
    IF v_product.team_id = p_buyer_id THEN
        RAISE EXCEPTION 'Cannot buy your own product';
    END IF;

    -- 3. Get Buyer info and lock row
    SELECT * INTO v_buyer FROM teams WHERE id = p_buyer_id FOR UPDATE;
    IF v_buyer.balance < p_amount THEN
        RAISE EXCEPTION 'Insufficient funds';
    END IF;

    -- 4. Process transaction
    -- Deduct from buyer
    UPDATE teams SET 
        balance = balance - p_amount,
        items_bought = items_bought + 1
    WHERE id = p_buyer_id;

    -- 5. Add to seller
    UPDATE teams SET 
        balance = balance + p_amount,
        items_sold = items_sold + 1
    WHERE id = v_product.team_id;

    -- Get Seller info
    SELECT * INTO v_seller FROM teams WHERE id = v_product.team_id;

    -- 6. Record transaction
    INSERT INTO transactions (buyer_team_id, seller_team_id, product_id, amount)
    VALUES (p_buyer_id, v_product.team_id, p_product_id, p_amount);

    -- 7. Insert Notification
    INSERT INTO notifications (message, type)
    VALUES (v_buyer.name || ' bought ' || v_product.name || ' from ' || v_seller.name || ' for ₹' || p_amount, 'market');

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
