import axios from "axios";
import type {
  VideoMode, RaceData, RaceInfo, DriverStanding, ConstructorStanding,
  PitStop, LapTiming, UpcomingRace, HistoricalCircuitResult,
} from "./types.js";

const BASE_URL = "https://api.jolpi.ca/ergast/f1";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function fetchWithRetry<T>(url: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.get<T>(url, { timeout: 15000 });
      return response.data;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.warn(`  Attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${msg}`);
      if (attempt === MAX_RETRIES) throw error;
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    }
  }
  throw new Error("Unreachable");
}

function parseRace(raceTable: any): RaceInfo {
  return {
    raceName: raceTable.raceName,
    round: raceTable.round,
    date: raceTable.date,
    circuit: {
      circuitId: raceTable.Circuit.circuitId,
      circuitName: raceTable.Circuit.circuitName,
      location: {
        locality: raceTable.Circuit.Location.locality,
        country: raceTable.Circuit.Location.country,
      },
    },
    results: (raceTable.Results || []).map((r: any) => ({
      position: r.position,
      number: r.number,
      driver: {
        givenName: r.Driver.givenName,
        familyName: r.Driver.familyName,
        nationality: r.Driver.nationality,
      },
      constructor: { name: r.Constructor.name },
      grid: r.grid,
      laps: r.laps,
      status: r.status,
      time: r.Time ? { millis: r.Time.millis, time: r.Time.time } : undefined,
      fastestLap: r.FastestLap
        ? {
            rank: r.FastestLap.rank,
            lap: r.FastestLap.lap,
            time: { time: r.FastestLap.Time.time },
          }
        : undefined,
    })),
  };
}

function parseDriverStandings(data: any): DriverStanding[] {
  return data.MRData.StandingsTable.StandingsLists[0].DriverStandings.map((s: any) => ({
    position: s.position,
    points: s.points,
    wins: s.wins,
    driver: { givenName: s.Driver.givenName, familyName: s.Driver.familyName },
    constructors: s.Constructors.map((c: any) => ({ name: c.name })),
  }));
}

function parseConstructorStandings(data: any): ConstructorStanding[] {
  return data.MRData.StandingsTable.StandingsLists[0].ConstructorStandings.map((s: any) => ({
    position: s.position,
    points: s.points,
    wins: s.wins,
    constructor: { name: s.Constructor.name },
  }));
}

async function fetchBaseData(): Promise<{
  race: RaceInfo;
  driverStandings: DriverStanding[];
  constructorStandings: ConstructorStanding[];
  totalRounds: number;
}> {
  console.log("[F1 Data] Fetching latest race results...");
  const raceResp = await fetchWithRetry<any>(`${BASE_URL}/current/last/results.json`);
  const raceTable = raceResp.MRData.RaceTable.Races[0];
  if (!raceTable) throw new Error("No race data found for the current season");
  const race = parseRace(raceTable);

  console.log("[F1 Data] Fetching driver standings...");
  const driverResp = await fetchWithRetry<any>(`${BASE_URL}/current/driverStandings.json`);
  const driverStandings = parseDriverStandings(driverResp);

  console.log("[F1 Data] Fetching constructor standings...");
  const constructorResp = await fetchWithRetry<any>(`${BASE_URL}/current/constructorStandings.json`);
  const constructorStandings = parseConstructorStandings(constructorResp);

  // Get total rounds in the season
  console.log("[F1 Data] Fetching season schedule...");
  const scheduleResp = await fetchWithRetry<any>(`${BASE_URL}/current.json`);
  const totalRounds = scheduleResp.MRData.RaceTable.Races.length;

  console.log(
    `[F1 Data] Got data for Round ${race.round}/${totalRounds}: ${race.raceName} at ${race.circuit.circuitName}`
  );

  return { race, driverStandings, constructorStandings, totalRounds };
}

async function fetchPitStops(round: string): Promise<PitStop[]> {
  console.log("[F1 Data] Fetching pit stop data...");
  try {
    const resp = await fetchWithRetry<any>(`${BASE_URL}/current/${round}/pitstops.json?limit=100`);
    const stops = resp.MRData.RaceTable.Races[0]?.PitStops || [];
    return stops.map((s: any) => ({
      driverId: s.driverId,
      driverName: s.driverId, // Will be enriched later
      lap: s.lap,
      stop: s.stop,
      duration: s.duration,
    }));
  } catch {
    console.warn("[F1 Data] Pit stop data not available");
    return [];
  }
}

async function fetchLapTimings(round: string): Promise<LapTiming[]> {
  console.log("[F1 Data] Fetching lap timing data (first 10 + last 10 laps)...");
  try {
    // Fetch key laps: first 10 and last 10 for strategic analysis
    const timings: LapTiming[] = [];

    const firstResp = await fetchWithRetry<any>(
      `${BASE_URL}/current/${round}/laps.json?limit=10`
    );
    const firstLaps = firstResp.MRData.RaceTable.Races[0]?.Laps || [];

    const totalLaps = parseInt(firstResp.MRData.total) || 60;
    const lastLapStart = Math.max(totalLaps - 10, 11);

    const lastResp = await fetchWithRetry<any>(
      `${BASE_URL}/current/${round}/laps.json?limit=10&offset=${lastLapStart - 1}`
    );
    const lastLaps = lastResp.MRData.RaceTable.Races[0]?.Laps || [];

    for (const lap of [...firstLaps, ...lastLaps]) {
      timings.push({
        lap: lap.number,
        timings: (lap.Timings || []).map((t: any) => ({
          driverId: t.driverId,
          driverName: t.driverId,
          position: t.position,
          time: t.time,
        })),
      });
    }

    return timings;
  } catch {
    console.warn("[F1 Data] Lap timing data not available");
    return [];
  }
}

async function fetchUpcomingRace(): Promise<UpcomingRace | null> {
  console.log("[F1 Data] Fetching season schedule for next race...");
  const resp = await fetchWithRetry<any>(`${BASE_URL}/current.json`);
  const races = resp.MRData.RaceTable.Races;

  const now = new Date();
  for (const race of races) {
    const raceDate = new Date(race.date);
    if (raceDate > now) {
      return {
        round: race.round,
        raceName: race.raceName,
        date: race.date,
        circuit: {
          circuitId: race.Circuit.circuitId,
          circuitName: race.Circuit.circuitName,
          location: {
            locality: race.Circuit.Location.locality,
            country: race.Circuit.Location.country,
          },
        },
      };
    }
  }
  return null;
}

async function fetchCircuitHistory(circuitId: string): Promise<HistoricalCircuitResult[]> {
  console.log(`[F1 Data] Fetching historical results for circuit: ${circuitId}...`);
  try {
    const resp = await fetchWithRetry<any>(
      `${BASE_URL}/circuits/${circuitId}/results.json?limit=100&offset=0`
    );
    const races = resp.MRData.RaceTable.Races || [];

    // Get last 10 years of results at this circuit
    const recentRaces = races.slice(-10);
    return recentRaces.map((race: any) => ({
      season: race.season,
      raceName: race.raceName,
      podium: (race.Results || []).slice(0, 3).map((r: any) => ({
        position: r.position,
        driver: `${r.Driver.givenName} ${r.Driver.familyName}`,
        constructor: r.Constructor.name,
      })),
    }));
  } catch {
    console.warn("[F1 Data] Historical circuit data not available");
    return [];
  }
}

export async function fetchRaceData(mode: VideoMode = "race"): Promise<RaceData> {
  const base = await fetchBaseData();

  const raceData: RaceData = {
    ...base,
  };

  if (mode === "race") {
    raceData.pitStops = await fetchPitStops(base.race.round);
    raceData.lapTimings = await fetchLapTimings(base.race.round);
  }

  if (mode === "prediction") {
    const upcoming = await fetchUpcomingRace();
    if (upcoming) {
      raceData.upcomingRace = upcoming;
      raceData.circuitHistory = await fetchCircuitHistory(upcoming.circuit.circuitId);
    } else {
      console.warn("[F1 Data] No upcoming race found — season may be over");
    }
  }

  return raceData;
}
