# Harbor

Tabletop prototype of a multi-agent team that helps a hospital recover from ransomware.

Incident Command, Containment, Clinical Continuity, Recovery, Communications, and Compliance share one incident picture. You approve each step. The drill keeps care moving on paper, isolates affected IT, and restores a clean backup in clinical order.

## Run

```bash
python3 app.py
```

Open the URL it prints (http://127.0.0.1:8765).

```bash
python3 -m harbor.session
```

That runs the happy path without the browser and prints the closing time.

This is a simulation for defense and recovery planning. It does not scan networks, decrypt malware, or connect to hospital systems.
