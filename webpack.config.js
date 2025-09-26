const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const webpack = require('webpack');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'public'),
    filename: 'static/[name].[contenthash].js',
    chunkFilename: 'static/[name].[contenthash].chunk.js',
    publicPath: '/',
    clean: true
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          priority: 10
        },
        xterm: {
          test: /[\\/]node_modules[\\/](xterm)/,
          name: 'xterm',
          priority: 20
        },
        charts: {
          test: /[\\/]node_modules[\\/](chart\.js|react-chartjs-2)/,
          name: 'charts',
          priority: 20
        }
      }
    },
    runtimeChunk: 'single',
    minimize: true
  },
  performance: {
    hints: false,
    maxEntrypointSize: 512000,
    maxAssetSize: 512000
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js', '.jsx']
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        use: 'ts-loader',
        exclude: /node_modules/
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader']
      },
      {
        test: /\.(png|jpg|gif|svg)$/,
        type: 'asset/resource',
        generator: {
          filename: 'static/images/[name][ext]'
        }
      }
    ]
  },
  plugins: [
    new HtmlWebpackPlugin({
      title: 'AutomataControls™ Remote Portal',
      filename: 'index.html',
      meta: {
        viewport: 'width=device-width, initial-scale=1.0'
      },
      templateContent: `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8">
          <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Cinzel+Decorative:wght@400;700&display=swap" rel="stylesheet">
        </head>
        <body>
          <div id="root"></div>
        </body>
        </html>
      `
    }),
    new CopyWebpackPlugin({
      patterns: [
        { 
          from: 'public/automata-nexus-logo.png', 
          to: 'automata-nexus-logo.png' 
        }
      ]
    }),
    new webpack.DefinePlugin({
      'process.env': JSON.stringify({
        NODE_ENV: 'production'
      })
    })
  ],
  devServer: {
    static: {
      directory: path.join(__dirname, 'public')
    },
    compress: true,
    port: 3000,
    proxy: {
      '/api': 'http://localhost:8000',
      '/socket.io': {
        target: 'http://localhost:8000',
        ws: true
      }
    }
  }
};