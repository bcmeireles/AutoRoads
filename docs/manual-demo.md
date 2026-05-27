# Manual Demo Acceptance Scenario

1. Start the backend and frontend with `npm run dev`.
2. Open `http://127.0.0.1:5173`.
3. Select a moving car in the city.
4. Increase parking scarcity and traffic density.
5. Watch the selected car request a parking decision near its destination.
6. Confirm the inspector shows:
   - selected parking spot
   - nearest baseline
   - random baseline
   - model version
   - candidate scores
   - explanation terms
7. Change objective weights and reset the simulation.
8. Confirm decisions shift in a way that matches the changed weights.

Known v1 limitations: simplified physics, deterministic road-rule logic, synthetic training data, and no perception-level autonomous driving.

