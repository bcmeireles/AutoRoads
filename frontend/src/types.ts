export type Vec2 = {
  x: number;
  z: number;
};

export type RoadNode = {
  id: string;
  position: Vec2;
  control?: "stop" | "traffic-light";
};

export type RoadEdge = {
  id: string;
  from: string;
  to: string;
  oneWay?: boolean;
  speedLimit: number;
};

export type Building = {
  id: string;
  name: string;
  position: Vec2;
  size: Vec2;
  height: number;
  kind: "office" | "retail" | "residential" | "civic";
};

export type Destination = {
  id: string;
  name: string;
  nodeId: string;
  position: Vec2;
  demand: number;
};

export type ParkingSpot = {
  id: string;
  nodeId: string;
  position: Vec2;
  price: number;
  baseAvailability: number;
  occupancyRisk: number;
  legal: boolean;
  accessible: boolean;
};

export type ScenarioSettings = {
  trafficDensity: number;
  parkingScarcity: number;
  tripDemand: number;
  driveTimeWeight: number;
  walkDistanceWeight: number;
  priceWeight: number;
  availabilityRiskWeight: number;
  congestionWeight: number;
};

export type CarAgentState =
  | "spawned"
  | "routing"
  | "driving"
  | "choosing_parking"
  | "parking"
  | "parked"
  | "blocked";

export type ParkingDecisionStatus =
  | "idle"
  | "pending"
  | "backend"
  | "fallback"
  | "blocked";

export type CarAgent = {
  id: string;
  color: string;
  position: Vec2;
  currentNodeId: string;
  destinationId: string;
  path: string[];
  pathIndex: number;
  state: CarAgentState;
  speed: number;
  chosenSpotId?: string;
  baselineSpotId?: string;
  randomBaselineSpotId?: string;
  modelVersion?: string;
  explanation?: ExplanationTerm[];
  candidateScores?: CandidateScore[];
  decisionRequested?: boolean;
  parkingDecisionStatus?: ParkingDecisionStatus;
  parkingDecisionError?: string;
  waitSeconds?: number;
};

export type CandidateScore = {
  spot_id: string;
  score: number;
  eligible: boolean;
  rank: number;
};

export type ExplanationTerm = {
  feature: string;
  impact: number;
  direction: "helps" | "hurts";
  detail: string;
};

export type CityMap = {
  nodes: RoadNode[];
  edges: RoadEdge[];
  buildings: Building[];
  destinations: Destination[];
  parkingSpots: ParkingSpot[];
};
