package com.workchat.tracker.db;

import com.workchat.tracker.config.AppConfig;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

public final class DataSourceFactory {
    private static HikariDataSource ds;

    private DataSourceFactory() {
    }

    public static synchronized HikariDataSource create(AppConfig cfg) {
        if (ds == null) {
            HikariConfig hc = new HikariConfig();
            hc.setPoolName("workchat-pool");
            hc.setJdbcUrl(cfg.dbUrl());
            hc.setUsername(cfg.dbUser());
            hc.setPassword(cfg.dbPassword());
            hc.setMaximumPoolSize(cfg.dbPoolSize());
            hc.setMinimumIdle(1);
            hc.setConnectionTimeout(5000);
            hc.setConnectionInitSql("SELECT 1");
            ds = new HikariDataSource(hc);
        }
        return ds;
    }

    public static synchronized void close() {
        if (ds != null) {
            ds.close();
            ds = null;
        }
    }
}