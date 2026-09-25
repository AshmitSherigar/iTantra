import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_LANGUAGE_ID,
  SUPPORTED_LANGUAGES,
  getLanguage,
  isLanguageInstalled,
  type LanguageId,
  type LanguageModel,
} from '../features/models/languages';

const STORAGE_KEY = 'app:selected-language';

type LanguageContextType = {
  /** Raw id, e.g. 'en'. Defaults to English on first launch. */
  selectedId: LanguageId;
  /** Full registry entry for the selected language. */
  selectedLanguage: LanguageModel;
  /** False until the persisted value (or default) has loaded. */
  isLoaded: boolean;
  /** Persist a new selection. */
  selectLanguage: (id: LanguageId) => Promise<void>;
  /** Whether the selected language's models ship with the app. */
  isSelectedInstalled: boolean;
};

const LanguageContext = createContext<LanguageContextType | null>(null);

function isValidId(v: string | null): v is LanguageId {
  return (
    v != null &&
    (SUPPORTED_LANGUAGES as LanguageModel[]).some((l) => l.id === v)
  );
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Default to English immediately so the UI never renders "no language".
  const [selectedId, setSelectedId] = useState<LanguageId>(DEFAULT_LANGUAGE_ID);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (!cancelled && isValidId(stored)) {
          setSelectedId(stored);
        }
        // Anything else (null / unknown) keeps the English default -
        // and persists it so next launch is instant.
        if (!cancelled && !isValidId(stored)) {
          try {
            await AsyncStorage.setItem(STORAGE_KEY, DEFAULT_LANGUAGE_ID);
          } catch {}
        }
      } catch {
        // Storage failure -> stay on English default.
      } finally {
        if (!cancelled) setIsLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectLanguage = useCallback(async (id: LanguageId) => {
    setSelectedId(id);
    try {
      await AsyncStorage.setItem(STORAGE_KEY, id);
    } catch (e) {
      console.warn('[Language] Failed to persist selection:', e);
    }
  }, []);

  const value = useMemo<LanguageContextType>(() => {
    const selectedLanguage = getLanguage(selectedId);
    return {
      selectedId,
      selectedLanguage,
      isLoaded,
      selectLanguage,
      isSelectedInstalled: isLanguageInstalled(selectedLanguage),
    };
  }, [selectedId, isLoaded, selectLanguage]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextType {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used inside LanguageProvider');
  }
  return ctx;
}
