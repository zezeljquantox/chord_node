const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const redis = require('redis');
const conn = require('./mysql_connection');
var dateTime = require('node-datetime');

const port = process.env.PORT || 3000;
var app = express();
var server = http.createServer(app);
var io = socketIO(server);

const redisClient = redis.createClient({db:1});

redisClient.subscribe('user-reacted');
redisClient.subscribe('house-swap');

var users = new Map();
var socketUser = new Map(); 

io.use(function(socket, next){    
    users.set(parseInt(socket.handshake.query.user), socket);
    socketUser.set(socket.id, {id: parseInt(socket.handshake.query.user), name: socket.handshake.query.name}); 
    return next();  
});

io.on('connection', (socket, data) => {
    console.log("new user connected");
    
    socket.on("getUserList", (data, callback) => {
        let query = "select likes1.b, u.name from likes as likes1 inner join likes as likes2 "+
        "on likes1.a =likes2.b and likes1.b =likes2.a "+
        "inner join users as u on likes1.b = u.id "+
        "where likes1.`like` = 1 and likes2.`like` = 1 and likes1.a = ?";
        conn.query(query , [socketUser.get(socket.id).id], (error, result, fields) => {
            if (error) throw error;
            var usersForChat = []; 
            let signedInUser = socketUser.get(socket.id);
            result.forEach(function(row) {               
                let tmpUser = {
                    id: row.b,
                    name: row.name,
                    active: 0
                };
                
                if(users.has(row.b)){
                    tmpUser.active = 1;                                      
                    users.get(row.b).emit("userAvailable", signedInUser);
                }
                
                usersForChat.push(tmpUser);              
              });
              
              callback(usersForChat);
        }); 
    });

    socket.on("sendMessage", (data, callback) => {
        let to = parseInt(data.to);
        let from = socketUser.get(socket.id).id;
        
        if(users.has(to)){
            users.get(to).emit("newMessage", {from: from, name: socketUser.get(socket.id).name, message: data.message});
            let sentTime = dateTime.create().format('Y-m-d H:M:S');
            //let sentTime = "0000-00-00 00:00:00";
            let query = "INSERT INTO chats SET `from` = ?, `to` = ?, message = ?, date = ?";
        conn.query(query , [from, to, data.message, sentTime], (error, result, fields) => {
            if (error) {
                console.log(error);
            }
        });
            callback({from: from, to: to, message: data.message});         
        }
    });

    socket.on("removeUserFromChat", (data) => {
        if(users.has(data)){
            users.get(data).emit("UserRemovedReaction", {id: socketUser.get(socket.id).id});
        }
    });

    socket.on('disconnect',  () => {
        socket.broadcast.emit("userDisconnected", {id: socketUser.get(socket.id).id});
        for (var [userId, socketId] of users) {
            if(socket == socketId){
                users.delete(userId);
                break;
            }
          }
          socketUser.delete(socket.id);      
        console.log("disconnected");
    });
});

redisClient.on("message", function(channel, message) {           
    let reaction = JSON.parse(message); 
    var data = reaction.data;
     
    switch(channel){    
        case 'user-reacted':
            if(reaction.event == "UserReactedOnHouse" && users.has(data.reaction.b)){
            //let data = reaction.data.reaction;
            //io.sockets.broadcast.to(users.get(reaction.data.reaction.b)).emit("UserReacted", {user:reaction.data.reaction.a,like:reaction.data.reaction.like}); 
                           
                users.get(data.reaction.b).emit("UserReacted", {user:data.reaction.a,like:data.reaction.like});                    
                            
            } else if(reaction.event == "OpenChat") {
                //let data = reaction.data;
                console.log('upao u open chat');
                 if(users.has(data.userA.id)){
                    var userA = socketUser.get(users.get(data.userA.id).id);
                 }                             
                
                if(users.has(data.userB.id)){
                    var userB = socketUser.get(users.get(data.userB.id).id);
                }
                console.log(userA, userB);
                if(typeof userB !== "undefined"){
                    let tmpUserA = {id: data.userA.id, name: data.userA.name};
                    tmpUserA.active = typeof userA !== "undefined" ? 1 : 0;                       
                    users.get(data.userB.id).emit("NewUserForChat", tmpUserA);
                }
                if(typeof userA !== "undefined"){
                    let tmpUserB = {id: data.userB.id, name: data.userB.name};
                    tmpUserB.active = typeof userB !== "undefined" ? 1 : 0; 
                    users.get(data.userA.id).emit("NewUserForChat", tmpUserB); 
                }  
                                                            
            }
            break;                
        case 'house-swap':
            if(reaction.event == "UserSwappedHouse"){
                //let data = reaction.data;
                
                if(users.has(data.house.user_id)){
                    let address = [
                                    data.address.district, data.address.locality, data.address.street, data.address.site, 
                                    data.address.site_number,data.address.site_description, data.address.site_subdescription
                                ];
                    address = address.filter(s => s.trim());                       
                    address = address.filter(String).join(', ');
                    
                    users.get(data.user.id).emit("UserSwappedHouse", {user: data.house.user_id, address: address});
                       
                }
            }
            break;
        default:
            break;
    }
                                
});

/*
io.on('disconnect', (reason) => {
    console.log("User was disconnected");
});
*/
server.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});