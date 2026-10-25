// Command Center — the standalone technical portal (index.html, "/").
//
// The multi-agent security portal: it starts from real hardware, scans the
// device's actual code with real Semgrep/Bandit (honest timing), ranks the
// findings and opens each one into the vulnerable source. This is the
// "multi-agentic" expansion the earlier DashboardPanel command center
// anticipated. The Patient Ward simulation lives on the separate sim.html page.

import { PortalApp } from '../portal/PortalApp';

export function CommandCenter() {
  return <PortalApp />;
}
