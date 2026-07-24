# Multi-stage build for the Spring Boot orchestrator.
#
# The orchestrator handles NO untrusted code itself -- it only calls the tracer
# services -- so it does not need gVisor. It does need to be small and boot fast.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
# Cache dependencies separately from source so code changes do not re-download.
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B clean package -DskipTests

FROM eclipse-temurin:21-jre-jammy
WORKDIR /app
COPY --from=build /build/target/visualizer-backend-*.jar app.jar

# Run unprivileged.
RUN useradd --uid 10002 --create-home app
USER app

EXPOSE 8080
# Container memory is small on the free tier; let the JVM see the cgroup limit
# and keep the heap modest.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=60 -XX:+UseSerialGC"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
