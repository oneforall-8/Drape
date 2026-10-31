import { Plus, Settings as Gear, Sparkles } from "lucide-react";
import { useEffect } from "react";
import { load } from "./lib/db";
import { useRoute, useStore, useToastHost } from "./lib/hooks";
import AddPage from "./pages/Add";
import Builder from "./pages/Builder";
import Closet from "./pages/Closet";
import Insights from "./pages/Insights";
import ItemPage from "./pages/ItemPage";
import Looks from "./pages/Looks";
import Plan from "./pages/Plan";
import SettingsPage from "./pages/Settings";
import Stylist from "./pages/Stylist";
import Today from "./pages/Today";

const NAV = [
  { to: "/", label: "today" },
  { to: "/closet", label: "closet" },
  { to: "/looks", label: "looks" },
  { to: "/plan", label: "plan" },
  { to: "/stylist", label: "stylist" },
  { to: "/insights", label: "insights" },
  { to: "/settings", label: "settings" },
];

export default function App() {
  const { ready, settings } = useStore();
  const { parts, params } = useRoute();
  const toastMsg = useToastHost();

  useEffect(() => { load(); }, []);
  useEffect(() => {
    const el = document.documentElement;
    if (settings.theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", settings.theme);
  }, [settings.theme]);

  const top = "/" + (parts[0] || "");
  const isOn = (to: string) => (to === "/" ? top === "/" : top === to || (to === "/closet" && top === "/item") || (to === "/looks" && top === "/look"));

  let page = null;
  if (ready) {
    switch (parts[0]) {
      case undefined: page = <Today />; break;
      case "closet": page = <Closet />; break;
      case "item": page = <ItemPage key={parts[1]} id={parts[1]} />; break;
      case "add": page = <AddPage params={params} />; break;
      case "looks": page = <Looks />; break;
      case "look": page = <Builder key={parts[1] + params.toString()} id={parts[1]} params={params} />; break;
      case "plan": page = <Plan />; break;
      case "stylist": page = <Stylist />; break;
      case "insights": page = <Insights />; break;
      case "settings": page = <SettingsPage />; break;
      default: page = <Today />;
    }
  }

  return (
    <div className="sheet">
      <header className="topbar">
        <a href="#/" className="wordmark">Drape</a>
        <nav className="topnav">
          {NAV.map((n) => <a key={n.to} href={"#" + n.to} className={isOn(n.to) ? "on" : ""}>{n.label}</a>)}
          <a href="#/add" className={isOn("/add") ? "on" : ""}>+ add</a>
        </nav>
        <div className="top-actions mobile-only">
          <a className="iconbtn" href="#/stylist" aria-label="Stylist"><Sparkles size={20} strokeWidth={1.5} /></a>
          <a className="iconbtn" href="#/insights" aria-label="Insights" style={{ fontFamily: "var(--hand)", fontSize: 20 }}>stats</a>
          <a className="iconbtn" href="#/settings" aria-label="Settings"><Gear size={20} strokeWidth={1.5} /></a>
        </div>
      </header>
      <main>{page}</main>
      <nav className="bottomnav">
        <a href="#/" className={isOn("/") ? "on" : ""}>today</a>
        <a href="#/closet" className={isOn("/closet") ? "on" : ""}>closet</a>
        <a href="#/add" className="plus" aria-label="Add a piece"><Plus size={24} /></a>
        <a href="#/looks" className={isOn("/looks") ? "on" : ""}>looks</a>
        <a href="#/plan" className={isOn("/plan") ? "on" : ""}>plan</a>
      </nav>
      {toastMsg && <div className="toast" role="status">{toastMsg}</div>}
    </div>
  );
}
