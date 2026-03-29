CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    IF current_setting('app.preserve_updated_at', true) = 'true' AND NEW.updated_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
