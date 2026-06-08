import { db } from "@dokploy/server/db";
import { server } from "@dokploy/server/db/schema";
import { findServerById, updateServerById } from "@dokploy/server/services/server";
import { getWebServerSettings } from "@dokploy/server/services/web-server-settings";
import type { ContainerCreateOptions } from "dockerode";
import { eq, sql } from "drizzle-orm";
import { IS_CLOUD } from "../constants";
import { getDokployImageTag } from "../services/settings";
import { pullImage, pullRemoteImage } from "../utils/docker/utils";
import { execAsync, execAsyncRemote } from "../utils/process/execAsync";
import { getRemoteDocker } from "../utils/servers/remote-docker";

export const setupMonitoring = async (serverId: string) => {
	const server = await findServerById(serverId);

	const containerName = "dokploy-monitoring";
	let imageName = "dokploy/monitoring:latest";

	if (
		(getDokployImageTag() !== "latest" ||
			process.env.NODE_ENV === "development") &&
		!IS_CLOUD
	) {
		imageName = "dokploy/monitoring:canary";
	}

	const settings: ContainerCreateOptions = {
		name: containerName,
		Env: [`METRICS_CONFIG=${JSON.stringify(server?.metricsConfig)}`],
		Image: imageName,
		HostConfig: {
			// Memory: 100 * 1024 * 1024, // 100MB en bytes
			// PidMode: "host",
			// CapAdd: ["NET_ADMIN", "SYS_ADMIN"],
			// Privileged: true,
			RestartPolicy: {
				Name: "always",
			},
			PortBindings: {
				[`${server.metricsConfig.server.port}/tcp`]: [
					{
						HostPort: server.metricsConfig.server.port.toString(),
					},
				],
			},
			Binds: [
				"/var/run/docker.sock:/var/run/docker.sock:ro",
				"/sys:/host/sys:ro",
				"/etc/os-release:/etc/os-release:ro",
				"/proc:/host/proc:ro",
				"/etc/dokploy/monitoring/monitoring.db:/app/monitoring.db",
			],
			NetworkMode: "host",
		},
		ExposedPorts: {
			[`${server.metricsConfig.server.port}/tcp`]: {},
		},
	};
	const docker = await getRemoteDocker(serverId);
	try {
		await execAsyncRemote(
			serverId,
			"mkdir -p /etc/dokploy/monitoring && touch /etc/dokploy/monitoring/monitoring.db",
		);
		if (serverId) {
			await pullRemoteImage(imageName, serverId);
		}

		// Check if container exists
		const container = docker.getContainer(containerName);
		try {
			await container.inspect();
			await container.remove({ force: true });
			console.log("Removed existing container");
		} catch {
			// Container doesn't exist, continue
		}

		await docker.createContainer(settings);
		const newContainer = docker.getContainer(containerName);
		await newContainer.start();

		console.log("Monitoring Started ");
	} catch (error) {
		console.log("Monitoring Not Found: Starting ", error);
	}
};

// Auto-register an app in the server's monitoring include list on first successful deploy.
// Uses a single atomic SQL statement to avoid a read-modify-write race when two apps
// deploy to the same server simultaneously.
// No-op if monitoring is not configured or the app is already listed.
export const addAppToServerMonitoring = async (
	appName: string,
	serverId: string | null | undefined,
) => {
	if (!serverId) return;

	try {
		const srv = await findServerById(serverId);

		// Only act when monitoring is actually set up (token present)
		if (!srv?.metricsConfig?.server?.token) return;

		// Atomically append appName to the include array only if not already present.
		// jsonb_set + || avoids a separate read and eliminates the concurrent-write race.
		await db
			.update(server)
			.set({
				metricsConfig: sql`jsonb_set(
					"metricsConfig",
					'{containers,services,include}',
					(
						CASE
							WHEN "metricsConfig" #> '{containers,services,include}' IS NULL
								THEN '[]'::jsonb
							ELSE "metricsConfig" #> '{containers,services,include}'
						END
					) || CASE
						WHEN (
							CASE
								WHEN "metricsConfig" #> '{containers,services,include}' IS NULL
									THEN '[]'::jsonb
								ELSE "metricsConfig" #> '{containers,services,include}'
							END
						) @> ${JSON.stringify([appName])}::jsonb
						THEN '[]'::jsonb
						ELSE ${JSON.stringify([appName])}::jsonb
					END
				)`,
			})
			.where(eq(server.serverId, serverId));

		await setupMonitoring(serverId);
	} catch (error) {
		// Non-fatal — monitoring failure should never block a deployment
		console.error("addAppToServerMonitoring failed:", error);
	}
};

export const setupWebMonitoring = async () => {
	const webServerSettings = await getWebServerSettings();

	const containerName = "dokploy-monitoring";
	let imageName = "dokploy/monitoring:latest";

	if (
		(getDokployImageTag() !== "latest" ||
			process.env.NODE_ENV === "development") &&
		!IS_CLOUD
	) {
		imageName = "dokploy/monitoring:canary";
	}

	const settings: ContainerCreateOptions = {
		name: containerName,
		Env: [`METRICS_CONFIG=${JSON.stringify(webServerSettings?.metricsConfig)}`],
		Image: imageName,
		HostConfig: {
			// Memory: 100 * 1024 * 1024, // 100MB en bytes
			// PidMode: "host",
			// CapAdd: ["NET_ADMIN", "SYS_ADMIN"],
			// Privileged: true,
			RestartPolicy: {
				Name: "always",
			},
			PortBindings: {
				[`${webServerSettings?.metricsConfig?.server?.port}/tcp`]: [
					{
						HostPort: webServerSettings?.metricsConfig?.server?.port.toString(),
					},
				],
			},
			Binds: [
				"/var/run/docker.sock:/var/run/docker.sock:ro",
				"/sys:/host/sys:ro",
				"/etc/os-release:/etc/os-release:ro",
				"/proc:/host/proc:ro",
				"/etc/dokploy/monitoring/monitoring.db:/app/monitoring.db",
			],
			// NetworkMode: "host",
		},
		ExposedPorts: {
			[`${webServerSettings?.metricsConfig?.server?.port}/tcp`]: {},
		},
	};
	const docker = await getRemoteDocker();
	try {
		await execAsync(
			"mkdir -p /etc/dokploy/monitoring && touch /etc/dokploy/monitoring/monitoring.db",
		);
		await pullImage(imageName);

		const container = docker.getContainer(containerName);
		try {
			await container.inspect();
			await container.remove({ force: true });
			console.log("Removed existing container");
		} catch {}

		await docker.createContainer(settings);
		const newContainer = docker.getContainer(containerName);
		await newContainer.start();

		console.log("Monitoring Started ");
	} catch (error) {
		console.log("Monitoring Not Found: Starting ", error);
	}
};
