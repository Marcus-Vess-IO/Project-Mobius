import readline from "readline";

export const setupGracefulExit = (subscription = null) => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const exitHandler = () => {
    if (subscription && typeof subscription.unsubscribe === "function") {
      subscription.unsubscribe();
    }
    rl.close();
    console.log("Exiting application. Goodbye!");
    process.exit(0);
  };

  // Handle Ctrl+C and termination signals
  process.on("SIGINT", exitHandler);
  process.on("SIGTERM", exitHandler);

  // Terminal input for exit
  rl.on("line", (input) => {
    if (input.trim().toLowerCase() === "q" || input.trim().toLowerCase() === "exit") {
      exitHandler();
    }
  });

  // Return the exit handler in case you want to call it manually
  return exitHandler;
};