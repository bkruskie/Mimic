import { useEffect, useState } from "react";
import { BuilderScreen } from "./screens/BuilderScreen";
import { SheetScreen } from "./screens/SheetScreen";
import { VaultScreen } from "./screens/VaultScreen";

export type Route = { name: "vault" } | { name: "new" } | { name: "sheet"; id: string };

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "new") return { name: "new" };
  const m = /^c\/([\w-]+)$/.exec(path);
  if (m) return { name: "sheet", id: m[1]! };
  return { name: "vault" };
}

export function go(route: Route) {
  const hash = route.name === "vault" ? "#/" : route.name === "new" ? "#/new" : `#/c/${route.id}`;
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
  if (route.name === "sheet") return <SheetScreen key={route.id} id={route.id} />;
  return <VaultScreen />;
}
