# Java tracer image.
#
# This service compiles and RUNS untrusted Java (each trace forks a debuggee
# JVM), so in production it runs under gVisor -- see docker-compose.yml. It needs
# a full JDK, not a JRE: the tracer uses the system Java compiler (javax.tools)
# and JDI, neither of which exists in a JRE.

FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -q -B dependency:go-offline
COPY src ./src
RUN mvn -q -B clean package -DskipTests

FROM eclipse-temurin:21-jdk-jammy
WORKDIR /app
COPY --from=build /build/target/tracer-java.jar app.jar

# Untrusted code runs as this user (and each debuggee JVM inherits it), never root.
RUN useradd --uid 10003 --create-home tracer
USER tracer

ENV PORT=8082
EXPOSE 8082
# Cap the tracer JVM's own heap; the debuggee JVMs it launches are separately
# short-lived and killed on timeout.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=50 -XX:+UseSerialGC"
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar app.jar"]
