import { useEffect, useState } from "react";
import { BuilderScreen } from "./screens/BuilderScreen";
import { JoinScreen } from "./screens/JoinScreen";
import { SheetScreen } from "./screens/SheetScreen";
import { VaultScreen } from "./screens/VaultScreen";

export type Route = { name: "vault" } | { name: "new" } | { name: "sheet"; id: string } | { name: "join"; code: string | null };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "new") return { name: "new" };
  if (path === "join") return { name: "join", code: null };
  const j = /^join\/([\w-]+)$/.exec(path);
  if (j) return { name: "join", code: j[1]! };
  const m = /^c\/([\w-]+)$/.exec(path);
  if (m) return { name: "sheet", id: m[1]! };
  return { name: "vault" };
}

export function go(route: Route) {
  const hash =
    route.name === "vault" ? "#/" : route.name === "new" ? "#/new" : route.name === "join" ? (route.code ? `#/join/${route.code}` : "#/join") : `#/c/${route.id}`;
  if (window.location.hash !== hash) window.location.hash = hash;
}

export function App() {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onHash = () => {
      setRoute(parse(window.location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (route.name === "new") return <BuilderScreen />;
  if (route.name === "join") return <JoinScreen code={route.code} />;
  if (route.name === "sheet") return <SheetScreen key={route.id} id={route.id} />;
  return <VaultScreen />;
}
