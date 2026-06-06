import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth } from "@/lib/firebase";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionExpired, setSessionExpired] = useState(false);
  const wasLoggedInRef = useRef(false);
  const intentionalSignOutRef = useRef(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        wasLoggedInRef.current = true;
        intentionalSignOutRef.current = false;
        setSessionExpired(false);
      } else if (wasLoggedInRef.current && !intentionalSignOutRef.current) {
        setSessionExpired(true);
      }

      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const markIntentionalSignOut = useCallback(() => {
    intentionalSignOutRef.current = true;
    wasLoggedInRef.current = false;
    setSessionExpired(false);
  }, []);

  const markSessionExpired = useCallback(() => {
    setSessionExpired(true);
  }, []);

  const resetSessionExpiry = useCallback(() => {
    intentionalSignOutRef.current = false;
    wasLoggedInRef.current = false;
    setSessionExpired(false);
  }, []);

  return {
    user,
    loading,
    sessionExpired,
    markIntentionalSignOut,
    markSessionExpired,
    resetSessionExpiry,
  };
}
