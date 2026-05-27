# AutoRoads Roadmap

AutoRoads should grow from a parking-decision demo into a live, inspectable city simulation in deliberate layers. The roadmap uses GitHub milestones as version releases. Labels describe area/type/priority/size, while project fields track execution state.

## Version Milestones

### V1 Parking Intelligence Slice

Finish the local parking intelligence demo: 2.5D simulation polish, deterministic driving behavior, FastAPI parking decisions, synthetic ML training, and clear local-only documentation.

### V2 District Scenario City

Move from a hardcoded scene to one coherent city made of districts. The city should be schema-first, with roads, buildings, zones, parking, destinations, spawn rules, traffic controls, and scenario metadata loaded from fixtures.

The first scenario set should live inside one district city, not as disconnected toy maps:

- downtown scarcity
- commuter corridor
- event surge
- residential commute
- constrained parking zone

### V3 Procedural District Generator

Add deterministic district generation from templates and constraints. The expansion unit is a district chunk, not raw grid cells. Chunks expose connector contracts for roads, zoning edges, parking capacity, expected demand, and generation seed.

The road graph remains authoritative for driving. The grid/chunk layer exists for generation, spatial occupancy, and expansion boundaries.

### V4 NPC Schedule Agents

Add NPCs as schedule-owning agents, separate from cars. NPCs should have homes, workplaces, errands, daily routines, trip plans, parking decisions, and recent history.

Runtime should use active + aggregate simulation: selected or nearby NPCs are fully simulated, while offscreen population contributes aggregate demand and traffic pressure.

### V5 District City Editor

Build a district-level editor after the schema, generator, and NPC model exist. Editor v1 supports roads, buildings, parking lots, zones, destinations, traffic controls, and scenario settings. It should avoid full-city freeform editing and NPC schedule authoring in its first release.

### V6 Live City Simulation Polish

Make the city feel alive through time-of-day rhythms, population flows, congestion waves, recurring schedules, history playback, and city-level metrics.

The final success metric is inspectable lives: every selected NPC should tell a coherent story through home, work, schedule, current trip, vehicle, parking choices, and history.

## Project Rules

- Every issue belongs to exactly one version milestone.
- Epics remain GitHub issues labeled `type: epic`.
- Project `Status` stays broad: `Todo`, `In Progress`, `Done`.
- Custom `Workflow` tracks triage depth: `To Triage`, `Triaged`, `In Progress`, `Done`.
- Future features should not skip the schema layer; editor and NPC work both depend on the district city model becoming stable first.

