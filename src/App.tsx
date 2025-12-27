import React from "react";
import { Tabs, TabList, Tab, TabPanel } from "react-tabs";
import "react-tabs/style/react-tabs.css";
import ElectricityDashboard from "./ElectricityDashboard";
import RatedCapacity from "./RatedCapacity";

export default function App() {
  return (
    // Wrap Tabs in a page container so the pill bar sits slightly below the top edge
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-4 pt-4">
        <Tabs>
          {/* Add spacing + rounded container to bring tabs down and keep them inside content */}
          <div className="mt-2">
            <TabList>
              <Tab>Generation</Tab>
              <Tab>Peak Demand Met</Tab>
              <Tab>Supply</Tab>
              <Tab>Coal PLF</Tab>
              <Tab>RTM Prices</Tab>
              <Tab>Rated Capacity</Tab>
            </TabList>
          </div>

          <TabPanel>
            <ElectricityDashboard
              type="generation"
              title="India Electricity Generation Dashboard"
              subtitle="Daily generation data, trends, and YoY/MoM analytics"
              seriesLabel="Generation"
              // ✅ Units explicitly MU for Generation
              unitLabel="MU"
              valueColumnKey="generation_gwh"
              defaultCsvPath="/data/generation.csv"
              enableAutoFetch={true}
              calcMode="sum"
              valueDisplay={{
                // ✅ All display strings show MU
                suffix: " MU",
                decimals: 2,
              }}
            />
          </TabPanel>

          <TabPanel>
            <ElectricityDashboard
              type="demand"
              title="India Peak Demand Met Dashboard"
              subtitle="Daily peak demand met data, trends, and YoY/MoM analytics"
              seriesLabel="Peak Demand Met"
              // Keeping MU to avoid breaking any existing formatting expectations in this repo.
              // If your Peak Demand CSV is in MW, you can change unitLabel/suffix/decimals later.
              unitLabel="MU"
              valueColumnKey="demand_gwh"
              // ✅ renamed file
              defaultCsvPath="/data/Peak Demand.csv"
              enableAutoFetch={false}
              // ✅ switch to averages for peak metric
              calcMode="avg"
              valueDisplay={{
                suffix: " MU",
                decimals: 2,
              }}
            />
          </TabPanel>

          <TabPanel>
            <ElectricityDashboard
              type="supply"
              title="India Electricity Supply Dashboard"
              subtitle="Daily supply data, trends, and YoY/MoM analytics"
              seriesLabel="Supply"
              // ✅ Units explicitly MU for Supply
              unitLabel="MU"
              valueColumnKey="supply_gwh"
              defaultCsvPath="/data/supply.csv"
              enableAutoFetch={false}
              calcMode="sum"
              valueDisplay={{
                // ✅ All display strings show MU
                suffix: " MU",
                decimals: 2,
              }}
            />
          </TabPanel>

          <TabPanel>
            <ElectricityDashboard
              type="coal-plf"
              title="India Coal PLF Dashboard"
              subtitle="Coal PLF trends, period averages, and YoY/WoW analytics"
              seriesLabel="Coal PLF"
              unitLabel="%"
              valueColumnKey="coal_plf"
              // IMPORTANT: file has space in name
              defaultCsvPath="/data/Coal PLF.csv"
              enableAutoFetch={false}
              calcMode="avg"
              valueDisplay={{
                suffix: "%",
                decimals: 2,
              }}
            />
          </TabPanel>

          <TabPanel>
            <ElectricityDashboard
              type="rtm-prices"
              title="India RTM Prices Dashboard"
              subtitle="RTM price trends, period averages, and YoY/WoW analytics"
              seriesLabel="RTM Prices"
              unitLabel="Rs/Unit"
              valueColumnKey="rtm_price"
              defaultCsvPath="/data/RTM Prices.csv"
              enableAutoFetch={false}
              calcMode="avg"
              valueDisplay={{
                suffix: " Rs/Unit",
                decimals: 2,
              }}
            />
          </TabPanel>

          <TabPanel>
            <RatedCapacity />
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}
