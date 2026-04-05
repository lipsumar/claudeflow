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

export async function connectContainerToNetwork(
  docker: Docker,
  networkName: string,
  containerName: string,
): Promise<void> {
  const network = docker.getNetwork(networkName);
  await network.connect({ Container: containerName });
}

export async function disconnectContainerFromNetwork(
  docker: Docker,
  networkName: string,
  containerName: string,
): Promise<void> {
  const network = docker.getNetwork(networkName);
  await network.disconnect({ Container: containerName });
}

export async function getContainerIpOnNetwork(
  docker: Docker,
  networkName: string,
  containerName: string,
): Promise<string> {
  const container = docker.getContainer(containerName);
  const info = await container.inspect();
  const networkSettings = info.NetworkSettings.Networks[networkName];
  if (!networkSettings?.IPAddress) {
    throw new Error(
      `Container ${containerName} has no IP on network ${networkName}`,
    );
  }
  return networkSettings.IPAddress;
}

// Convenience wrappers kept for backwards compat
export async function connectSquidToNetwork(
  docker: Docker,
  networkName: string,
  squidContainerName: string,
): Promise<string> {
  await connectContainerToNetwork(docker, networkName, squidContainerName);
  return getContainerIpOnNetwork(docker, networkName, squidContainerName);
}

export async function disconnectSquidFromNetwork(
  docker: Docker,
  networkName: string,
  squidContainerName: string,
): Promise<void> {
  await disconnectContainerFromNetwork(docker, networkName, squidContainerName);
}
