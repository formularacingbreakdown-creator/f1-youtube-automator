export type VideoMode = "race" | "championship" | "prediction";

export interface DriverResult {
  position: string;
  number: string;
  driver: {
    givenName: string;
    familyName: string;
    nationality: string;
  };
  constructor: {
    name: string;
  };
  grid: string;
  laps: string;
  status: string;
  time?: { millis?: string; time?: string };
  fastestLap?: {
    rank: string;
    lap: string;
    time: { time: string };
  };
}

export interface RaceInfo {
  raceName: string;
  round: string;
  date: string;
  circuit: {
    circuitId: string;
    circuitName: string;
    location: { locality: string; country: string };
  };
  results: DriverResult[];
}

export interface DriverStanding {
  position: string;
  points: string;
  wins: string;
  driver: {
    givenName: string;
    familyName: string;
  };
  constructors: { name: string }[];
}

export interface ConstructorStanding {
  position: string;
  points: string;
  wins: string;
  constructor: {
    name: string;
  };
}

export interface PitStop {
  driverId: string;
  driverName: string;
  lap: string;
  stop: string;
  duration: string;
}

export interface LapTiming {
  lap: string;
  timings: {
    driverId: string;
    driverName: string;
    position: string;
    time: string;
  }[];
}

export interface HistoricalCircuitResult {
  season: string;
  raceName: string;
  podium: {
    position: string;
    driver: string;
    constructor: string;
  }[];
}

export interface UpcomingRace {
  round: string;
  raceName: string;
  date: string;
  circuit: {
    circuitId: string;
    circuitName: string;
    location: { locality: string; country: string };
  };
}

export interface RaceData {
  race: RaceInfo;
  driverStandings: DriverStanding[];
  constructorStandings: ConstructorStanding[];
  totalRounds?: number;
  // Race mode extras
  pitStops?: PitStop[];
  lapTimings?: LapTiming[];
  // Prediction mode extras
  upcomingRace?: UpcomingRace;
  circuitHistory?: HistoricalCircuitResult[];
}

export interface ScriptOutput {
  title: string;
  description: string;
  tags: string[];
  script: string;
}
