import { IS_CLOUD } from "@dokploy/server/constants";
import { validateRequest } from "@dokploy/server/lib/auth";
import { hasPermission } from "@dokploy/server/services/permission";
import { Loader2, Server } from "lucide-react";
import type { GetServerSidePropsContext } from "next";
import type { ReactElement } from "react";
import { useState } from "react";
import { ContainerFreeMonitoring } from "@/components/dashboard/monitoring/free/container/show-free-container-monitoring";
import { ShowPaidMonitoring } from "@/components/dashboard/monitoring/paid/servers/show-paid-monitoring";
import { DashboardLayout } from "@/components/layouts/dashboard-layout";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { api } from "@/utils/api";

const DEV_BASE_URL = "http://localhost:3001/metrics";
const DEV_TOKEN = "metrics";
const LOCAL_SERVER_ID = "__local__";

const Dashboard = () => {
	const [selectedServerId, setSelectedServerId] =
		useState<string>(LOCAL_SERVER_ID);

	const { data: monitoring, isPending: monitoringPending } =
		api.user.getMetricsToken.useQuery();
	const { data: servers = [], isPending: serversPending } =
		api.server.all.useQuery();

	const isPending = monitoringPending || serversPending;

	// Build metrics URL + token for the selected server
	const metricsConfig = (() => {
		if (selectedServerId === LOCAL_SERVER_ID) {
			return {
				url:
					process.env.NODE_ENV === "production"
						? `http://${monitoring?.serverIp}:${monitoring?.metricsConfig?.server?.port}/metrics`
						: DEV_BASE_URL,
				token:
					process.env.NODE_ENV === "production"
						? (monitoring?.metricsConfig?.server?.token ?? "")
						: DEV_TOKEN,
				name: "Local Server",
				serverId: null as string | null,
			};
		}
		const server = servers.find((s) => s.serverId === selectedServerId);
		if (!server) return null;
		return {
			url: `http://${server.ipAddress}:${server.metricsConfig?.server?.port ?? 4500}/metrics`,
			token: server.metricsConfig?.server?.token ?? "",
			name: server.name,
			serverId: server.serverId,
		};
	})();

	// Base URL without trailing /metrics for container endpoint calls
	const metricsBaseUrl = metricsConfig?.url.replace(/\/metrics$/, "") ?? "";

	const { data: containersSummary, isPending: containersPending } =
		api.user.getContainersSummary.useQuery(
			{
				serverId: metricsConfig?.serverId,
			},
			{
				enabled: !!metricsConfig,
				refetchInterval: 30000,
			},
		);

	return (
		<div className="space-y-4 pb-10">
			{isPending ? (
				<Card className="bg-sidebar p-2.5 rounded-xl mx-auto items-center">
					<div className="rounded-xl bg-background flex shadow-md px-4 min-h-[50vh] justify-center items-center text-muted-foreground">
						Loading...
						<Loader2 className="h-4 w-4 animate-spin" />
					</div>
				</Card>
			) : (
				<>
					{/* Server selector — visible whenever remote servers are registered */}
					{servers.length > 0 && (
						<div className="flex items-center gap-3">
							<Server className="h-4 w-4 text-muted-foreground shrink-0" />
							<Select
								value={selectedServerId}
								onValueChange={setSelectedServerId}
							>
								<SelectTrigger className="w-[280px]">
									<SelectValue placeholder="Select server" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={LOCAL_SERVER_ID}>
										Local Server (Dokploy host)
									</SelectItem>
									{servers.map((server) => (
										<SelectItem
											key={server.serverId}
											value={server.serverId}
										>
											{server.name}
											{server.ipAddress
												? ` — ${server.ipAddress}`
												: ""}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}

					{selectedServerId === LOCAL_SERVER_ID &&
					servers.length === 0 ? (
						// Original free-tier view: container-level metrics for the Dokploy host
						<Card className="h-full bg-sidebar p-2.5 rounded-xl">
							<div className="rounded-xl bg-background shadow-md p-6">
								<ContainerFreeMonitoring appName="dokploy" />
							</div>
						</Card>
					) : metricsConfig ? (
						<>
							{/* Server-level metrics panel */}
							<Card className="bg-sidebar p-2.5 rounded-xl mx-auto">
								<div className="rounded-xl bg-background shadow-md">
									<ShowPaidMonitoring
										BASE_URL={metricsConfig.url}
										token={metricsConfig.token}
									/>
								</div>
							</Card>

							{/* Per-application resource usage table */}
							<Card className="bg-sidebar p-2.5 rounded-xl">
								<div className="rounded-xl bg-background shadow-md p-4">
									<div className="flex items-center justify-between mb-4">
										<h3 className="text-sm font-semibold">
											Application Resources
										</h3>
										{containersPending && (
											<Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
										)}
									</div>
									{containersSummary && containersSummary.length > 0 ? (
										<Table>
											<TableHeader>
												<TableRow>
													<TableHead>Application</TableHead>
													<TableHead>Status</TableHead>
													<TableHead className="text-right">
														CPU
													</TableHead>
													<TableHead className="text-right">
														Memory %
													</TableHead>
													<TableHead className="text-right">
														Memory Used
													</TableHead>
													<TableHead className="text-right">
														Net In
													</TableHead>
													<TableHead className="text-right">
														Net Out
													</TableHead>
												</TableRow>
											</TableHeader>
											<TableBody>
												{containersSummary.map((app) => (
													<TableRow key={app.applicationId}>
														<TableCell className="font-medium">
															<div className="flex flex-col">
																<span>{app.name}</span>
																<span className="text-xs text-muted-foreground">
																	{app.appName}
																</span>
															</div>
														</TableCell>
														<TableCell>
															<Badge
																variant={
																	app.applicationStatus ===
																	"running"
																		? "default"
																		: app.applicationStatus ===
																			  "error"
																			? "destructive"
																			: "secondary"
																}
																className="text-xs"
															>
																{app.applicationStatus}
															</Badge>
														</TableCell>
														<TableCell className="text-right font-mono text-sm">
															{app.metric
																? `${app.metric.CPU.toFixed(1)}%`
																: "—"}
														</TableCell>
														<TableCell className="text-right font-mono text-sm">
															{app.metric
																? `${app.metric.Memory.percentage.toFixed(1)}%`
																: "—"}
														</TableCell>
														<TableCell className="text-right font-mono text-sm">
															{app.metric
																? `${app.metric.Memory.used.toFixed(0)} ${app.metric.Memory.usedUnit}`
																: "—"}
														</TableCell>
														<TableCell className="text-right font-mono text-sm">
															{app.metric
																? `${app.metric.Network.input.toFixed(1)} ${app.metric.Network.inputUnit}`
																: "—"}
														</TableCell>
														<TableCell className="text-right font-mono text-sm">
															{app.metric
																? `${app.metric.Network.output.toFixed(1)} ${app.metric.Network.outputUnit}`
																: "—"}
														</TableCell>
													</TableRow>
												))}
											</TableBody>
										</Table>
									) : (
										<p className="text-sm text-muted-foreground text-center py-8">
											{containersPending
												? "Loading application metrics…"
												: "No application metrics available. Container monitoring may not be configured yet, or no apps are deployed on this server."}
										</p>
									)}
								</div>
							</Card>
						</>
					) : (
						<Card className="h-full bg-sidebar p-2.5 rounded-xl">
							<div className="rounded-xl bg-background shadow-md p-6">
								<ContainerFreeMonitoring appName="dokploy" />
							</div>
						</Card>
					)}
				</>
			)}
		</div>
	);
};

export default Dashboard;

Dashboard.getLayout = (page: ReactElement) => {
	return <DashboardLayout>{page}</DashboardLayout>;
};

export async function getServerSideProps(
	ctx: GetServerSidePropsContext<{ serviceId: string }>,
) {
	if (IS_CLOUD) {
		return {
			redirect: { permanent: false, destination: "/dashboard/home" },
		};
	}
	const { user, session } = await validateRequest(ctx.req);
	if (!user) {
		return {
			redirect: { permanent: false, destination: "/" },
		};
	}

	const canView = await hasPermission(
		{
			user: { id: user.id },
			session: { activeOrganizationId: session?.activeOrganizationId || "" },
		},
		{ monitoring: ["read"] },
	);

	if (!canView) {
		return {
			redirect: { permanent: false, destination: "/dashboard/home" },
		};
	}

	return { props: {} };
}
