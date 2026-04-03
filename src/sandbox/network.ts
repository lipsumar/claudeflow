import type Docker from "dockerode";

function networkName(runId: string): string {
  return `claudeflow-run-${runId}`;
}

export async function createRunNetwork(
  docker: Docker,
  runId: string,
): Promise<string> {
  const name = networkName(runId);
  await docker.createNetwork({
    Name: name,
    Internal: true,
  });
  return name;
}

export async function destroyRunNetwork(
  docker: Docker,
  runId: string,
): Promise<void> {
  const name = networkName(runId);
  const network = docker.getNetwork(name);
  await network.remove();
}

export async function connectSquidToNetwork(
  docker: Docker,
  networkName: string,
  squidContainerName: string,
): Promise<string> {
  const network = docker.getNetwork(networkName);
  await network.connect({ Container: squidContainerName });
  return getSquidIpOnNetwork(docker, networkName, squidContainerName);
}

export async function disconnectSquidFromNetwork(
  docker: Docker,
  networkName: string,
  squidContainerName: string,
): Promise<void> {
  const network = docker.getNetwork(networkName);
  await network.disconnect({ Container: squidContainerName });
}

export async function getSquidIpOnNetwork(
  docker: Docker,
  networkName: string,
  squidContainerName: string,
): Promise<string> {
  const container = docker.getContainer(squidContainerName);
  const info = await container.inspect();
  const networkSettings = info.NetworkSettings.Networks[networkName];
  if (!networkSettings?.IPAddress) {
    throw new Error(
      `Squid container ${squidContainerName} has no IP on network ${networkName}`,
    );
  }
  return networkSettings.IPAddress;
}
