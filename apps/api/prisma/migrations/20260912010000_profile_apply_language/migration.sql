-- Idioma de postulación por defecto del perfil (auto = idioma de la vacante).
ALTER TABLE "Profile" ADD COLUMN "applyLanguage" TEXT NOT NULL DEFAULT 'auto';
