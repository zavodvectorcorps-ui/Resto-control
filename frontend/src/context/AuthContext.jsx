import { createContext, useContext, useEffect, useState } from "react";
import api from "@/lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // null = loading
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("resto_token");
    if (!token) {
      setReady(true);
      return;
    }
    api
      .get("/auth/me")
      .then(({ data }) => setUser(data))
      .catch(() => {
        localStorage.removeItem("resto_token");
        setUser(false);
      })
      .finally(() => setReady(true));
  }, []);

  const login = (token, u) => {
    localStorage.setItem("resto_token", token);
    setUser(u);
  };

  const logout = () => {
    localStorage.removeItem("resto_token");
    setUser(false);
  };

  return (
    <AuthCtx.Provider value={{ user, ready, login, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
